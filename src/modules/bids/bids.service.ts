import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Bid } from '../../entities/bid.entity';
import { TransportRequest } from '../../entities/transport-request.entity';
import { Booking } from '../../entities/booking.entity';
import { BidStatus, RequestStatus, UserRole } from '../../common/enums';
import { assertTransition } from '../../common/state-machine';
import { CreateBidDto } from './dto/create-bid.dto';
import { CounterBidDto } from './dto/counter-bid.dto';
import { RejectCounterDto } from './dto/reject-counter.dto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class BidsService {
  constructor(
    @InjectRepository(Bid)
    private readonly bidRepo: Repository<Bid>,
    @InjectRepository(TransportRequest)
    private readonly requestRepo: Repository<TransportRequest>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(driverId: string, dto: CreateBidDto) {
    const request = await this.requestRepo.findOne({
      where: { id: dto.request_id },
    });
    if (!request) throw new NotFoundException('Request not found');

    if (
      request.status !== RequestStatus.OPEN &&
      request.status !== RequestStatus.BIDDING
    ) {
      throw new BadRequestException({
        code: 'REQUEST_NOT_BIDDABLE',
        message: 'Request is not accepting bids',
      });
    }

    const existingBid = await this.bidRepo.findOne({
      where: { request_id: dto.request_id, driver_id: driverId },
    });
    if (existingBid) {
      throw new BadRequestException({
        code: 'ALREADY_BID',
        message: 'You have already placed a bid on this request',
      });
    }

    const bid = await this.bidRepo.save(
      this.bidRepo.create({
        request_id: dto.request_id,
        driver_id: driverId,
        price_tnd: dto.price_tnd,
        eta_minutes: dto.eta_minutes,
        message: dto.message ?? null,
      }),
    );

    // Transition OPEN → BIDDING on first bid
    if (request.status === RequestStatus.OPEN) {
      assertTransition(request.status, RequestStatus.BIDDING);
      await this.requestRepo.update(request.id, {
        status: RequestStatus.BIDDING,
      });
    }

    console.log(
      `[BID] New bid on request ${dto.request_id} from driver ${driverId}`,
    );

    // Notify client on every new bid
    await this.notificationsService.create(
      request.client_id,
      'bid_received',
      'New bid on your request',
      `request_id:${dto.request_id}`,
    );

    return bid;
  }

  async list(userId: string, role: UserRole, requestId: string) {
    const qb = this.bidRepo
      .createQueryBuilder('bid')
      .leftJoinAndSelect('bid.driver', 'driver')
      .where('bid.request_id = :requestId', { requestId });

    if (role === UserRole.DRIVER) {
      qb.andWhere('bid.driver_id = :userId', { userId });
    } else if (role === UserRole.CLIENT) {
      // verify client owns request
      const req = await this.requestRepo.findOne({ where: { id: requestId } });
      if (!req || req.client_id !== userId) {
        throw new ForbiddenException('Access denied');
      }
    }

    return qb.getMany();
  }

  async accept(bidId: string, clientId: string) {
    return this.acceptWithPrice(bidId, clientId, 'client', null);
  }

  // Shared acceptance flow. `agreedPrice` overrides the default (bid.price_tnd).
  // `actor` tells us whether this is the client accepting or the driver
  // accepting a client counter — affects which statuses are valid entry points
  // and which notifications go out.
  private async acceptWithPrice(
    bidId: string,
    actorId: string,
    actor: 'client' | 'driver',
    agreedPriceOverride: number | null,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const bid = await manager.findOne(Bid, {
        where: { id: bidId },
        relations: ['request'],
      });
      if (!bid) throw new NotFoundException('Bid not found');

      const request = bid.request;

      if (actor === 'client') {
        if (request.client_id !== actorId) {
          throw new ForbiddenException('Access denied');
        }
      } else {
        if (bid.driver_id !== actorId) {
          throw new ForbiddenException('Access denied');
        }
      }

      if (request.status !== RequestStatus.BIDDING) {
        throw new BadRequestException({
          code: 'REQUEST_NOT_BIDDING',
          message: 'Request is not in BIDDING status',
        });
      }

      const acceptableStatuses: BidStatus[] =
        actor === 'client'
          ? [BidStatus.PENDING, BidStatus.COUNTERED_BY_DRIVER]
          : [BidStatus.COUNTERED_BY_CLIENT];
      if (!acceptableStatuses.includes(bid.status)) {
        throw new BadRequestException({
          code: 'BID_NOT_ACCEPTABLE',
          message: `Bid in status ${bid.status} cannot be accepted by ${actor}`,
        });
      }

      const agreedPrice = agreedPriceOverride ?? Number(bid.price_tnd);

      // Accept this bid
      await manager.update(
        Bid,
        { id: bidId },
        { status: BidStatus.ACCEPTED, agreed_price_tnd: agreedPrice },
      );

      // Reject all other bids (including those mid-counter)
      await manager
        .createQueryBuilder()
        .update(Bid)
        .set({ status: BidStatus.REJECTED })
        .where(
          'request_id = :requestId AND id != :bidId AND status IN (:...statuses)',
          {
            requestId: request.id,
            bidId,
            statuses: [
              BidStatus.PENDING,
              BidStatus.COUNTERED_BY_CLIENT,
              BidStatus.COUNTERED_BY_DRIVER,
            ],
          },
        )
        .execute();

      // Create booking
      const booking = await manager.save(
        manager.create(Booking, {
          request_id: request.id,
          bid_id: bidId,
          driver_id: bid.driver_id,
          client_id: request.client_id,
        }),
      );

      // Transition request BIDDING → BOOKED
      assertTransition(request.status, RequestStatus.BOOKED);
      await manager.update(TransportRequest, request.id, {
        status: RequestStatus.BOOKED,
      });

      console.log(
        `[BID_ACCEPTED] Bid ${bidId} accepted at ${agreedPrice} TND, booking ${booking.id} created`,
      );

      // Notify winning driver
      await this.notificationsService.create(
        bid.driver_id,
        'bid_accepted',
        'Your bid was accepted!',
        `request_id:${request.id} · ${agreedPrice} TND`,
      );

      // Notify rejected drivers
      const rejectedBids = await manager.find(Bid, {
        where: { request_id: request.id, status: BidStatus.REJECTED },
      });
      await Promise.all(
        rejectedBids.map((rb) =>
          this.notificationsService.create(
            rb.driver_id,
            'bid_rejected',
            'Your bid was not selected',
            `Another driver was selected for this request.`,
          ),
        ),
      );

      // Notify client that booking was created
      await this.notificationsService.create(
        request.client_id,
        'booking_created',
        'Booking confirmed',
        `request_id:${request.id} · ${agreedPrice} TND`,
      );

      return booking;
    });
  }

  async reject(bidId: string, clientId: string) {
    const bid = await this.bidRepo.findOne({
      where: { id: bidId },
      relations: ['request'],
    });
    if (!bid) throw new NotFoundException('Bid not found');
    if (bid.request.client_id !== clientId)
      throw new ForbiddenException('Access denied');
    if (bid.status !== BidStatus.PENDING) {
      throw new BadRequestException({
        code: 'BID_NOT_PENDING',
        message: 'Only pending bids can be rejected',
      });
    }
    bid.status = BidStatus.REJECTED;
    const saved = await this.bidRepo.save(bid);

    await this.notificationsService.create(
      bid.driver_id,
      'bid_rejected',
      'Your bid was declined',
      'The client has declined your bid on this request.',
    );

    return saved;
  }

  async withdraw(bidId: string, driverId: string) {
    const bid = await this.bidRepo.findOne({
      where: { id: bidId },
      relations: ['request'],
    });
    if (!bid) throw new NotFoundException('Bid not found');
    if (bid.driver_id !== driverId)
      throw new ForbiddenException('Access denied');
    if (bid.status !== BidStatus.PENDING) {
      throw new BadRequestException({
        code: 'BID_NOT_PENDING',
        message: 'Only pending bids can be withdrawn',
      });
    }
    bid.status = BidStatus.WITHDRAWN;
    const saved = await this.bidRepo.save(bid);

    await this.notificationsService.create(
      bid.request.client_id,
      'bid_withdrawn',
      'A bid was withdrawn',
      'A driver has withdrawn their bid on your request.',
    );

    return saved;
  }

  // Client proposes a counter-offer on a driver's bid.
  // Entry states: PENDING (first counter) or COUNTERED_BY_DRIVER (client
  // re-counters after driver's "best I can do").
  async clientCounter(bidId: string, clientId: string, dto: CounterBidDto) {
    const bid = await this.bidRepo.findOne({
      where: { id: bidId },
      relations: ['request'],
    });
    if (!bid) throw new NotFoundException('Bid not found');
    if (bid.request.client_id !== clientId)
      throw new ForbiddenException('Access denied');

    const validFrom: BidStatus[] = [
      BidStatus.PENDING,
      BidStatus.COUNTERED_BY_DRIVER,
    ];
    if (!validFrom.includes(bid.status)) {
      throw new BadRequestException({
        code: 'BID_NOT_COUNTERABLE',
        message: `Bid in status ${bid.status} cannot be countered`,
      });
    }

    bid.status = BidStatus.COUNTERED_BY_CLIENT;
    bid.counter_price_tnd = dto.counter_price_tnd;
    bid.driver_final_price_tnd = null;
    const saved = await this.bidRepo.save(bid);

    await this.notificationsService.create(
      bid.driver_id,
      'bid_counter_received',
      'Client countered your bid',
      `request_id:${bid.request_id} · ${dto.counter_price_tnd} TND`,
    );

    return saved;
  }

  // Driver accepts the client's counter-offer — triggers the full accept flow,
  // booking creation, and competing-bid rejection. Agreed price is the counter.
  async driverAcceptCounter(bidId: string, driverId: string) {
    const bid = await this.bidRepo.findOne({ where: { id: bidId } });
    if (!bid) throw new NotFoundException('Bid not found');
    if (bid.status !== BidStatus.COUNTERED_BY_CLIENT) {
      throw new BadRequestException({
        code: 'NO_PENDING_COUNTER',
        message: 'No client counter to accept',
      });
    }
    if (bid.counter_price_tnd == null) {
      throw new BadRequestException({
        code: 'COUNTER_MISSING',
        message: 'Counter price is missing',
      });
    }
    return this.acceptWithPrice(
      bidId,
      driverId,
      'driver',
      Number(bid.counter_price_tnd),
    );
  }

  // Driver rejects the client's counter and proposes a final price
  // ("my best is X"). Bid moves to COUNTERED_BY_DRIVER — client can now
  // accept that final, counter again, or pass.
  async driverRejectCounter(
    bidId: string,
    driverId: string,
    dto: RejectCounterDto,
  ) {
    const bid = await this.bidRepo.findOne({
      where: { id: bidId },
      relations: ['request'],
    });
    if (!bid) throw new NotFoundException('Bid not found');
    if (bid.driver_id !== driverId)
      throw new ForbiddenException('Access denied');
    if (bid.status !== BidStatus.COUNTERED_BY_CLIENT) {
      throw new BadRequestException({
        code: 'NO_PENDING_COUNTER',
        message: 'No client counter to reject',
      });
    }

    bid.status = BidStatus.COUNTERED_BY_DRIVER;
    bid.driver_final_price_tnd = dto.driver_final_price_tnd;
    const saved = await this.bidRepo.save(bid);

    await this.notificationsService.create(
      bid.request.client_id,
      'bid_counter_rejected',
      'Driver countered back',
      `request_id:${bid.request_id} · ${dto.driver_final_price_tnd} TND`,
    );

    return saved;
  }

  // Client accepts the driver's final price from a COUNTERED_BY_DRIVER state.
  async clientAcceptDriverFinal(bidId: string, clientId: string) {
    const bid = await this.bidRepo.findOne({ where: { id: bidId } });
    if (!bid) throw new NotFoundException('Bid not found');
    if (bid.status !== BidStatus.COUNTERED_BY_DRIVER) {
      throw new BadRequestException({
        code: 'NO_DRIVER_FINAL',
        message: 'No driver final price to accept',
      });
    }
    if (bid.driver_final_price_tnd == null) {
      throw new BadRequestException({
        code: 'DRIVER_FINAL_MISSING',
        message: 'Driver final price is missing',
      });
    }
    return this.acceptWithPrice(
      bidId,
      clientId,
      'client',
      Number(bid.driver_final_price_tnd),
    );
  }
}
