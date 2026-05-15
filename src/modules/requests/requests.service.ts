import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { TransportRequest } from '../../entities/transport-request.entity';
import { DriverProfile } from '../../entities/driver-profile.entity';
import { Bid } from '../../entities/bid.entity';
import { H3Service, H3_RESOLUTION_FINE } from '../../common/h3/h3.service';
import { UploadService } from '../../common/upload/upload.service';
import { BidStatus, RequestStatus, UserRole } from '../../common/enums';
import { assertTransition } from '../../common/state-machine';
import { CreateRequestDto } from './dto/create-request.dto';
import { ListRequestsDto } from './dto/list-requests.dto';
import { NotificationsService } from '../notifications/notifications.service';

// A request that sits OPEN/BIDDING without any bid/counter activity for this
// long is auto-failed by the opportunistic sweep below.
const STALE_REQUEST_AFTER_MS = 15 * 24 * 60 * 60 * 1000;

@Injectable()
export class RequestsService {
  private sweepInFlight = false;

  constructor(
    @InjectRepository(TransportRequest)
    private readonly requestRepo: Repository<TransportRequest>,
    @InjectRepository(DriverProfile)
    private readonly driverProfileRepo: Repository<DriverProfile>,
    @InjectRepository(Bid)
    private readonly bidRepo: Repository<Bid>,
    private readonly h3Service: H3Service,
    private readonly uploadService: UploadService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // Fire-and-forget sweep trigger — same opportunistic pattern as the
  // bookings auto-confirm sweep. Reads kick it; the work runs next tick.
  private kickSweep(): void {
    if (this.sweepInFlight) return;
    this.sweepInFlight = true;
    setImmediate(async () => {
      try {
        await this.sweepStaleRequests();
      } finally {
        this.sweepInFlight = false;
      }
    });
  }

  // Auto-fail OPEN/BIDDING requests with no negotiation activity for
  // STALE_REQUEST_AFTER_MS. Concurrent sweepers are safe: the conditional
  // UPDATE only flips rows that are still OPEN/BIDDING, so the first writer
  // wins and the loser's affected = 0 short-circuits side effects.
  private async sweepStaleRequests(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_REQUEST_AFTER_MS);
    const candidates = await this.requestRepo.find({
      where: [
        { status: RequestStatus.OPEN, last_activity_at: LessThan(cutoff) },
        { status: RequestStatus.BIDDING, last_activity_at: LessThan(cutoff) },
      ],
      take: 50,
    });

    for (const candidate of candidates) {
      try {
        const result = await this.requestRepo
          .createQueryBuilder()
          .update(TransportRequest)
          .set({ status: RequestStatus.FAILED })
          .where('id = :id AND status IN (:...expected)', {
            id: candidate.id,
            expected: [RequestStatus.OPEN, RequestStatus.BIDDING],
          })
          .execute();

        if (!result.affected) continue;

        // Notify the client and any drivers still mid-negotiation. We don't
        // bother flipping bid rows to REJECTED here — the request being
        // FAILED is the authoritative signal, and the existing bid status
        // remains accurate as a historical record of where each driver was.
        const activeBids = await this.bidRepo.find({
          where: {
            request_id: candidate.id,
            status: In([
              BidStatus.PENDING,
              BidStatus.COUNTERED_BY_CLIENT,
              BidStatus.COUNTERED_BY_DRIVER,
            ]),
          },
        });

        await Promise.all([
          this.notificationsService.create(
            candidate.client_id,
            'request_expired',
            'Request expired',
            'Your request expired after 15 days without an agreement.',
          ),
          ...activeBids.map((b) =>
            this.notificationsService.create(
              b.driver_id,
              'request_expired',
              'Request expired',
              'A request you bid on expired without an agreement.',
            ),
          ),
        ]);

        console.log(
          `[REQUEST] Request ${candidate.id} auto-failed after 15d inactivity`,
        );
      } catch (err) {
        console.error(
          `[REQUEST] Inactivity sweep failed for ${candidate.id}:`,
          err,
        );
      }
    }
  }

  async create(clientId: string, dto: CreateRequestDto, files: Express.Multer.File[]) {
    const pickup_h3_index = this.h3Service.latLngToH3(
      dto.pickup_lat,
      dto.pickup_lng,
      H3_RESOLUTION_FINE,
    );
    const dropoff_h3_index = this.h3Service.latLngToH3(
      dto.dropoff_lat,
      dto.dropoff_lng,
      H3_RESOLUTION_FINE,
    );

    const photo_urls = await this.uploadService.compressAndSaveItemPhotos(files);

    const req = this.requestRepo.create({
      client_id: clientId,
      pickup_lat: dto.pickup_lat,
      pickup_lng: dto.pickup_lng,
      pickup_address: dto.pickup_address ?? null,
      pickup_h3_index,
      dropoff_lat: dto.dropoff_lat,
      dropoff_lng: dto.dropoff_lng,
      dropoff_address: dto.dropoff_address ?? null,
      dropoff_h3_index,
      item_category: dto.item_category,
      item_name: dto.item_name,
      description: dto.description,
      scheduled_at: dto.scheduled_at ? new Date(dto.scheduled_at) : null,
      photo_urls,
    });

    return this.requestRepo.save(req);
  }

  async list(userId: string, role: UserRole, dto: ListRequestsDto) {
    // Opportunistic 15-day inactivity sweep — fire and forget.
    this.kickSweep();
    const { status, page, limit, nearby_lat, nearby_lng, k } = dto;

    // Shared builder factory — we may run multiple times when auto-expanding
    // the geo radius, so the base WHERE clauses are reapplied per attempt.
    const buildBaseQb = () => {
      const qb = this.requestRepo
        .createQueryBuilder('req')
        .leftJoinAndSelect('req.client', 'client')
        .orderBy('req.created_at', 'DESC');

      if (role === UserRole.CLIENT) {
        qb.where('req.client_id = :userId', { userId });
      } else if (role === UserRole.DRIVER) {
        qb.where('req.status IN (:...statuses)', {
          statuses: [RequestStatus.OPEN, RequestStatus.BIDDING],
        });
      }
      // ADMIN: no filter

      if (status) {
        qb.andWhere('req.status = :status', { status });
      }
      return qb;
    };

    // Drivers can opt into a nearby filter by passing nearby_lat+nearby_lng.
    // We resolve the driver's H3 cell and require the request's pickup cell
    // to be within a kRing of it. Anchor is computed once per call.
    const driverAnchorH3 =
      role === UserRole.DRIVER && nearby_lat != null && nearby_lng != null
        ? this.h3Service.latLngToH3(nearby_lat, nearby_lng, H3_RESOLUTION_FINE)
        : null;

    // For nearby queries, auto-expand the search radius until we find
    // something or hit the cap. Each step roughly doubles the area; the
    // ladder gives the UI a small set of distinct "zoom levels" to display
    // ("expanded to ~2 km"). The starting k is whatever the client asked
    // for; we only move up from there.
    const K_LADDER = [2, 4, 6, 8];
    const expansionSteps = driverAnchorH3
      ? K_LADDER.filter((step) => step >= k)
      : [k];

    let items: TransportRequest[] = [];
    let total = 0;
    let kUsed = k;

    for (const candidateK of expansionSteps) {
      const qb = buildBaseQb();
      if (driverAnchorH3) {
        const ring = this.h3Service.getKRing(driverAnchorH3, candidateK);
        qb.andWhere('req.pickup_h3_index IN (:...ring)', { ring });
      }
      total = await qb.getCount();
      items = await qb
        .skip((page - 1) * limit)
        .take(limit)
        .getMany();
      kUsed = candidateK;
      // For non-nearby queries (no driverAnchorH3), the ladder is just [k]
      // so the loop runs once. For nearby queries, stop at the first k that
      // returns results.
      if (!driverAnchorH3 || items.length > 0) break;
    }

    // For drivers, attach H3 distance (relative to nearby anchor if provided,
    // otherwise to the driver's stored current_h3_index).
    if (role === UserRole.DRIVER) {
      let anchorH3: string | null = driverAnchorH3;
      if (!anchorH3) {
        const driverProfile = await this.driverProfileRepo.findOne({
          where: { user_id: userId },
        });
        anchorH3 = driverProfile?.current_h3_index ?? null;
      }

      const withDistance = items.map((r) => ({
        ...r,
        distance_h3: anchorH3
          ? (() => {
              try {
                return this.h3Service.h3Distance(anchorH3!, r.pickup_h3_index);
              } catch {
                return null;
              }
            })()
          : null,
      }));

      // If a nearby anchor was supplied, sort by distance ascending
      // (closest first), null/error distances pushed to the end.
      if (driverAnchorH3) {
        withDistance.sort((a, b) => {
          if (a.distance_h3 == null && b.distance_h3 == null) return 0;
          if (a.distance_h3 == null) return 1;
          if (b.distance_h3 == null) return -1;
          return a.distance_h3 - b.distance_h3;
        });
      }

      return {
        items: withDistance,
        total,
        page,
        limit,
        ...(driverAnchorH3 ? { k_used: kUsed } : {}),
      };
    }

    return { items, total, page, limit };
  }

  async findOne(requestId: string, userId: string, role: UserRole) {
    this.kickSweep();
    const req = await this.requestRepo.findOne({
      where: { id: requestId },
      relations: ['bids', 'bids.driver', 'bids.driver.driver_profile', 'client'],
    });
    if (!req) throw new NotFoundException('Request not found');

    if (
      role === UserRole.CLIENT &&
      req.client_id !== userId
    ) {
      throw new ForbiddenException('Access denied');
    }

    return req;
  }

  async cancel(requestId: string, clientId: string) {
    const req = await this.requestRepo.findOne({
      where: { id: requestId },
      relations: ['bids'],
    });
    if (!req) throw new NotFoundException('Request not found');
    if (req.client_id !== clientId)
      throw new ForbiddenException('Access denied');

    assertTransition(req.status, RequestStatus.CANCELLED);
    req.status = RequestStatus.CANCELLED;
    const saved = await this.requestRepo.save(req);

    await Promise.all(
      (req.bids ?? []).map((b) =>
        this.notificationsService.create(
          b.driver_id,
          'request_cancelled',
          'Request cancelled',
          'The client has cancelled a request you bid on.',
        ),
      ),
    );

    return saved;
  }

  // Hard-delete: only allowed on already-CANCELLED requests owned by the
  // caller. Bids attached to the request are removed first to satisfy the FK.
  // Photo files are unlinked from disk after the row is gone.
  async delete(requestId: string, clientId: string) {
    const req = await this.requestRepo.findOne({
      where: { id: requestId },
      relations: ['bids'],
    });
    if (!req) throw new NotFoundException('Request not found');
    if (req.client_id !== clientId)
      throw new ForbiddenException('Access denied');
    if (req.status !== RequestStatus.CANCELLED) {
      throw new BadRequestException(
        'Only cancelled requests can be deleted',
      );
    }

    if (req.bids?.length) {
      await this.bidRepo.delete(req.bids.map((b) => b.id));
    }
    await this.requestRepo.delete(req.id);

    for (const url of req.photo_urls ?? []) {
      try {
        this.uploadService.deleteFile(url.replace(/^\//, ''));
      } catch {
        // best-effort — DB row is gone, an orphaned file isn't worth a 500
      }
    }

    return { id: requestId };
  }

  async updateStatus(requestId: string, newStatus: RequestStatus) {
    const req = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Request not found');
    assertTransition(req.status, newStatus);
    req.status = newStatus;
    return this.requestRepo.save(req);
  }

  async findById(requestId: string) {
    const req = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Request not found');
    return req;
  }
}
