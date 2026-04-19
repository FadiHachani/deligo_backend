import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from '../../entities/booking.entity';
import { DriverProfile } from '../../entities/driver-profile.entity';
import { BookingStatus, RequestStatus, UserRole } from '../../common/enums';
import { assertTransition } from '../../common/state-machine';
import { NotificationsService } from '../notifications/notifications.service';
import { RequestsService } from '../requests/requests.service';
import { ListBookingsDto } from './dto/list-bookings.dto';
import type { TrackingGateway } from '../tracking/tracking.gateway';

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(DriverProfile)
    private readonly driverProfileRepo: Repository<DriverProfile>,
    private readonly notificationsService: NotificationsService,
    private readonly requestsService: RequestsService,
    @Optional() private readonly trackingGateway: TrackingGateway | null = null,
  ) {}

  async list(userId: string, role: UserRole, dto: ListBookingsDto) {
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

  async deliver(bookingId: string, driverId: string) {
    const booking = await this.getBookingForDriver(bookingId, driverId);
    assertTransition(booking.status, BookingStatus.DELIVERED);

    booking.status = BookingStatus.DELIVERED;
    booking.delivered_at = new Date();
    await this.bookingRepo.save(booking);

    await this.requestsService.updateStatus(
      booking.request_id,
      RequestStatus.DELIVERED,
    );

    await this.driverProfileRepo.increment(
      { user_id: driverId },
      'total_trips',
      1,
    );

    await Promise.all([
      this.notificationsService.create(
        booking.client_id,
        'booking_delivered',
        'Delivery completed',
        `Your delivery has been completed successfully.`,
      ),
      this.notificationsService.create(
        driverId,
        'booking_delivered',
        'Delivery completed',
        `You have completed the delivery.`,
      ),
    ]);

    console.log(
      `[BOOKING] Booking ${bookingId} delivered by driver ${driverId}`,
    );
    this.emitStatusChange(bookingId, BookingStatus.DELIVERED);

    return booking;
  }

  async fail(bookingId: string, driverId: string) {
    const booking = await this.getBookingForDriver(bookingId, driverId);
    assertTransition(booking.status, BookingStatus.FAILED);

    booking.status = BookingStatus.FAILED;
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

    console.log(`[BOOKING] Booking ${bookingId} failed`);
    this.emitStatusChange(bookingId, BookingStatus.FAILED);
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
