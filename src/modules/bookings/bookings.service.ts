import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { Booking } from '../../entities/booking.entity';
import { DriverProfile } from '../../entities/driver-profile.entity';
import { TransportRequest } from '../../entities/transport-request.entity';
import { BookingStatus, RequestStatus, UserRole } from '../../common/enums';
import { assertTransition } from '../../common/state-machine';
import { NotificationsService } from '../notifications/notifications.service';
import { RequestsService } from '../requests/requests.service';
import { UploadService } from '../../common/upload/upload.service';
import { ListBookingsDto } from './dto/list-bookings.dto';
import type { TrackingGateway } from '../tracking/tracking.gateway';

// How long a PENDING_CONFIRMATION booking can sit before the system
// auto-completes it on the driver's behalf. Driver's proof photo is the
// only evidence preserved in this case.
const AUTO_CONFIRM_AFTER_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class BookingsService {
  // Guards against piling up parallel sweeps when reads land faster than the
  // sweep finishes. A single in-flight sweep is plenty.
  private sweepInFlight = false;

  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(DriverProfile)
    private readonly driverProfileRepo: Repository<DriverProfile>,
    private readonly notificationsService: NotificationsService,
    private readonly requestsService: RequestsService,
    private readonly uploadService: UploadService,
    private readonly dataSource: DataSource,
    @Optional() private readonly trackingGateway: TrackingGateway | null = null,
  ) {}

  // Fire-and-forget sweep trigger. Reads call this synchronously; the actual
  // work runs on the event loop next tick so the request returns quickly.
  private kickSweep(): void {
    if (this.sweepInFlight) return;
    this.sweepInFlight = true;
    setImmediate(async () => {
      try {
        await this.sweepAutoConfirmations();
      } finally {
        this.sweepInFlight = false;
      }
    });
  }

  async list(userId: string, role: UserRole, dto: ListBookingsDto) {
    // Opportunistic sweep, fire-and-forget. We don't await it — the current
    // request returns immediately and a small backlog gets worked off on the
    // next few reads. Errors inside the sweep are logged but never bubble.
    this.kickSweep();
    const { status, page, limit } = dto;
    const qb = this.bookingRepo
      .createQueryBuilder('booking')
      .leftJoinAndSelect('booking.request', 'request')
      .leftJoinAndSelect('booking.bid', 'bid')
      .leftJoinAndSelect('booking.driver', 'driver')
      .leftJoinAndSelect('driver.driver_profile', 'driver_profile')
      .leftJoinAndSelect('booking.client', 'client')
      .orderBy('booking.id', 'DESC');

    if (role === UserRole.CLIENT) {
      qb.where('booking.client_id = :userId', { userId });
    } else if (role === UserRole.DRIVER) {
      qb.where('booking.driver_id = :userId', { userId });
    }

    if (status) {
      qb.andWhere('booking.status = :status', { status });
    }

    const total = await qb.getCount();
    const items = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return { items, total, page, limit };
  }

  async findOne(bookingId: string, userId: string, role: UserRole) {
    // Same opportunistic sweep as list(). Fire-and-forget so detail-page
    // polling doesn't pay sweep latency on every hit.
    this.kickSweep();
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId },
      relations: ['request', 'bid', 'driver', 'driver.driver_profile', 'client'],
    });
    if (!booking) throw new NotFoundException('Booking not found');

    if (
      role !== UserRole.ADMIN &&
      booking.client_id !== userId &&
      booking.driver_id !== userId
    ) {
      throw new ForbiddenException('Access denied');
    }

    return booking;
  }

  async start(bookingId: string, driverId: string) {
    const booking = await this.getBookingForDriver(bookingId, driverId);
    assertTransition(booking.status, BookingStatus.IN_TRANSIT);

    booking.status = BookingStatus.IN_TRANSIT;
    booking.started_at = new Date();
    await this.bookingRepo.save(booking);

    await this.requestsService.updateStatus(
      booking.request_id,
      RequestStatus.IN_TRANSIT,
    );

    await this.notificationsService.create(
      booking.client_id,
      'booking_started',
      'Your delivery is on the way',
      `Your delivery has started. Driver is en route.`,
    );

    console.log(
      `[BOOKING] Booking ${bookingId} started by driver ${driverId}`,
    );
    this.emitStatusChange(bookingId, BookingStatus.IN_TRANSIT);

    return booking;
  }

  // Driver uploads proof-of-delivery photo. Transitions IN_TRANSIT ->
  // PENDING_CONFIRMATION. The booking does NOT count as completed yet —
  // total_trips, delivered_at, and the request's DELIVERED status all wait
  // for confirmDelivery (or the 24h auto-confirm sweep).
  async deliver(
    bookingId: string,
    driverId: string,
    file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Proof-of-delivery photo is required');
    }

    const booking = await this.getBookingForDriver(bookingId, driverId);
    assertTransition(booking.status, BookingStatus.PENDING_CONFIRMATION);

    const photoPath =
      await this.uploadService.compressAndSaveDeliveryPhoto(file);

    booking.status = BookingStatus.PENDING_CONFIRMATION;
    booking.driver_proof_photo = photoPath;
    booking.driver_proof_at = new Date();
    await this.bookingRepo.save(booking);

    await this.notificationsService.create(
      booking.client_id,
      'booking_pending_confirmation',
      'Confirm your delivery',
      'Your driver has marked the delivery as complete. Please confirm receipt with a photo.',
    );

    console.log(
      `[BOOKING] Booking ${bookingId} awaiting client confirmation (driver=${driverId})`,
    );
    this.emitStatusChange(bookingId, BookingStatus.PENDING_CONFIRMATION);

    return booking;
  }

  // Client uploads receipt-confirmation photo. Transitions
  // PENDING_CONFIRMATION -> DELIVERED. This is where the trip-completion
  // side effects fire (total_trips, request DELIVERED status, both notifs).
  //
  // The booking flip, request status update, and trip-count increment are
  // wrapped in a single DB transaction so any DB-level failure rolls them
  // back together. The status flip uses a conditional UPDATE so a race with
  // the auto-confirm sweep can't double-increment trips — whichever writer
  // gets there first wins, the loser gets a 409.
  async confirmDelivery(
    bookingId: string,
    clientId: string,
    file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Confirmation photo is required');
    }

    // Cheap up-front auth check so we don't bother saving a photo to disk
    // for an unauthorized caller. The atomic claim inside the transaction
    // is the real gate against state races.
    const existing = await this.bookingRepo.findOne({
      where: { id: bookingId },
    });
    if (!existing) throw new NotFoundException('Booking not found');
    if (existing.client_id !== clientId) {
      throw new ForbiddenException('Only the client can confirm delivery');
    }
    if (existing.status !== BookingStatus.PENDING_CONFIRMATION) {
      // Trigger the state-machine's structured error for a clearer client
      // message ("Cannot transition from <X> to DELIVERED").
      assertTransition(existing.status, BookingStatus.DELIVERED);
    }

    const photoPath =
      await this.uploadService.compressAndSaveDeliveryPhoto(file);

    const booking = await this.dataSource.transaction(async (manager) => {
      // Atomic claim: only one writer can flip PENDING_CONFIRMATION ->
      // DELIVERED. If affected = 0, another writer (typically the
      // auto-confirm sweep) already did it.
      const claim = await manager
        .createQueryBuilder()
        .update(Booking)
        .set({
          status: BookingStatus.DELIVERED,
          client_confirmation_photo: photoPath,
          client_confirmed_at: new Date(),
          delivered_at: new Date(),
        })
        .where('id = :id AND status = :expected', {
          id: bookingId,
          expected: BookingStatus.PENDING_CONFIRMATION,
        })
        .execute();

      if (!claim.affected) {
        throw new BadRequestException({
          code: 'INVALID_STATUS_TRANSITION',
          message: 'Booking is no longer awaiting confirmation',
        });
      }

      // Mirror status onto the parent request. Done via the manager so a
      // failure here rolls back the booking flip too.
      const reqRow = await manager.findOne(TransportRequest, {
        where: { id: existing.request_id },
      });
      if (!reqRow) throw new NotFoundException('Request not found');
      assertTransition(reqRow.status, RequestStatus.DELIVERED);
      reqRow.status = RequestStatus.DELIVERED;
      await manager.save(reqRow);

      await manager.increment(
        DriverProfile,
        { user_id: existing.driver_id },
        'total_trips',
        1,
      );

      const updated = await manager.findOne(Booking, {
        where: { id: bookingId },
      });
      // findOne is non-null here because the claim UPDATE just succeeded on
      // the same row; assert to satisfy TS.
      if (!updated) throw new NotFoundException('Booking not found');
      return updated;
    });

    // Post-commit side effects. Best-effort: if a notification fails to
    // insert we still consider the delivery confirmed. The websocket emit
    // and the console log both happen after the row is durable.
    await Promise.all([
      this.notificationsService.create(
        booking.client_id,
        'booking_delivered',
        'Delivery completed',
        'You confirmed receipt. Delivery is now complete.',
      ),
      this.notificationsService.create(
        booking.driver_id,
        'booking_delivered',
        'Delivery confirmed',
        'The client confirmed receipt of the delivery.',
      ),
    ]).catch((err) => {
      console.error(
        `[BOOKING] Post-confirm notifications failed for ${bookingId}:`,
        err,
      );
    });

    console.log(
      `[BOOKING] Booking ${bookingId} confirmed by client ${clientId}`,
    );
    this.emitStatusChange(bookingId, BookingStatus.DELIVERED);

    return booking;
  }

  // Called opportunistically from list/findOne to close out PENDING_CONFIRMATION
  // bookings that have sat unconfirmed past the auto-confirm window. The
  // driver's proof photo stands as evidence; no client photo is recorded.
  //
  // Concurrency note: two parallel API requests can both observe the same
  // stale booking. To avoid double-incrementing total_trips or sending
  // duplicate notifications, we use a conditional UPDATE that flips status
  // only when it is still PENDING_CONFIRMATION. The first writer wins
  // (affected = 1); the loser sees affected = 0 and skips side effects.
  private async sweepAutoConfirmations(): Promise<void> {
    const cutoff = new Date(Date.now() - AUTO_CONFIRM_AFTER_MS);
    const candidates = await this.bookingRepo.find({
      where: {
        status: BookingStatus.PENDING_CONFIRMATION,
        driver_proof_at: LessThan(cutoff),
      },
      take: 50,
    });

    for (const candidate of candidates) {
      try {
        const result = await this.bookingRepo
          .createQueryBuilder()
          .update(Booking)
          .set({ status: BookingStatus.DELIVERED, delivered_at: new Date() })
          .where('id = :id AND status = :expected', {
            id: candidate.id,
            expected: BookingStatus.PENDING_CONFIRMATION,
          })
          .execute();

        // affected = 0 means another concurrent sweeper already claimed this
        // booking (or a client confirm landed in the same window). Either
        // way, the winner ran the side effects — we must not.
        if (!result.affected) continue;

        await this.requestsService.updateStatus(
          candidate.request_id,
          RequestStatus.DELIVERED,
        );
        await this.driverProfileRepo.increment(
          { user_id: candidate.driver_id },
          'total_trips',
          1,
        );
        await Promise.all([
          this.notificationsService.create(
            candidate.client_id,
            'booking_delivered',
            'Delivery auto-confirmed',
            'Your delivery was auto-confirmed after 24 hours without action.',
          ),
          this.notificationsService.create(
            candidate.driver_id,
            'booking_delivered',
            'Delivery auto-confirmed',
            'The booking was auto-confirmed after the 24h window expired.',
          ),
        ]);
        console.log(
          `[BOOKING] Booking ${candidate.id} auto-confirmed after 24h`,
        );
        this.emitStatusChange(candidate.id, BookingStatus.DELIVERED);
      } catch (err) {
        console.error(
          `[BOOKING] Auto-confirm failed for ${candidate.id}:`,
          err,
        );
      }
    }
  }

  async fail(
    bookingId: string,
    driverId: string,
    reason: { code: string; text?: string },
  ) {
    const booking = await this.getBookingForDriver(bookingId, driverId);
    assertTransition(booking.status, BookingStatus.FAILED);

    booking.status = BookingStatus.FAILED;
    booking.cancel_reason_code = reason.code;
    booking.cancel_reason_text = reason.text ?? null;
    booking.cancelled_by = driverId;
    booking.cancelled_at = new Date();
    await this.bookingRepo.save(booking);

    await this.requestsService.updateStatus(
      booking.request_id,
      RequestStatus.FAILED,
    );

    await this.notificationsService.create(
      booking.client_id,
      'booking_failed',
      'Delivery failed',
      `Unfortunately, your delivery could not be completed.`,
    );

    console.log(`[BOOKING] Booking ${bookingId} failed (${reason.code})`);
    this.emitStatusChange(bookingId, BookingStatus.FAILED);
    return booking;
  }

  // Client backs out of a confirmed booking before the driver starts the
  // trip. Booking transitions CONFIRMED -> CANCELLED and the underlying
  // request reverts to CANCELLED too (the booking was the realization of
  // the request — pulling out unwinds both).
  async cancel(
    bookingId: string,
    clientId: string,
    reason: { code: string; text?: string },
  ) {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId },
    });
    if (!booking) {
      throw new BadRequestException('Booking not found');
    }
    if (booking.client_id !== clientId) {
      throw new BadRequestException('Access denied');
    }
    assertTransition(booking.status, BookingStatus.CANCELLED);

    booking.status = BookingStatus.CANCELLED;
    booking.cancel_reason_code = reason.code;
    booking.cancel_reason_text = reason.text ?? null;
    booking.cancelled_by = clientId;
    booking.cancelled_at = new Date();
    await this.bookingRepo.save(booking);

    await this.requestsService.updateStatus(
      booking.request_id,
      RequestStatus.CANCELLED,
    );

    await this.notificationsService.create(
      booking.driver_id,
      'booking_cancelled',
      'Booking cancelled',
      'The client cancelled the booking before pickup.',
    );

    console.log(
      `[BOOKING] Booking ${bookingId} cancelled by client (${reason.code})`,
    );
    this.emitStatusChange(bookingId, BookingStatus.CANCELLED);
    return booking;
  }

  private async getBookingForDriver(bookingId: string, driverId: string) {
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.driver_id !== driverId)
      throw new ForbiddenException('Access denied');
    return booking;
  }

  async emitStatusChange(bookingId: string, status: BookingStatus): Promise<void> {
    this.trackingGateway?.emitBookingStatusChanged(bookingId, status);
  }
}
