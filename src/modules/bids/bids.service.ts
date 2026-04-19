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
      `A driver has placed a bid on your transport request.`,
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
    return this.dataSource.transaction(async (manager) => {
      const bid = await manager.findOne(Bid, {
        where: { id: bidId },
        relations: ['request'],
      });
      if (!bid) throw new NotFoundException('Bid not found');

      const request = bid.request;
      if (request.client_id !== clientId) {
        throw new ForbiddenException('Access denied');
      }
      if (request.status !== RequestStatus.BIDDING) {
        throw new BadRequestException({
          code: 'REQUEST_NOT_BIDDING',
          message: 'Request is not in BIDDING status',
        });
      }
      if (bid.status !== BidStatus.PENDING) {
        throw new BadRequestException({
          code: 'BID_NOT_PENDING',
          message: 'Bid is not in PENDING status',
        });
      }

      // Accept this bid
      await manager.update(Bid, { id: bidId }, { status: BidStatus.ACCEPTED });

      // Reject all other bids
      await manager
        .createQueryBuilder()
        .update(Bid)
        .set({ status: BidStatus.REJECTED })
        .where(
          'request_id = :requestId AND id != :bidId AND status = :status',
          {
            requestId: request.id,
            bidId,
            status: BidStatus.PENDING,
          },
        )
        .execute();

      // Create booking
      const booking = await manager.save(
        manager.create(Booking, {
          request_id: request.id,
          bid_id: bidId,
          driver_id: bid.driver_id,
          client_id: clientId,
        }),
      );

      // Transition request BIDDING → BOOKED
      assertTransition(request.status, RequestStatus.BOOKED);
      await manager.update(TransportRequest, request.id, {
        status: RequestStatus.BOOKED,
      });

      console.log(
        `[BID_ACCEPTED] Bid ${bidId} accepted, booking ${booking.id} created`,
      );

      // Notify winning driver
      await this.notificationsService.create(
        bid.driver_id,
        'bid_accepted',
        'Your bid was accepted!',
        `Your bid for the transport request has been accepted.`,
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
        clientId,
        'booking_created',
        'Booking confirmed',
        `Your transport booking has been created.`,
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
}
