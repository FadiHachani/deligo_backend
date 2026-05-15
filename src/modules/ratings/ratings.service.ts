import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Rating } from '../../entities/rating.entity';
import { Booking } from '../../entities/booking.entity';
import { DriverProfile } from '../../entities/driver-profile.entity';
import { User } from '../../entities/user.entity';
import { BookingStatus } from '../../common/enums';
import { CreateRatingDto } from './dto/create-rating.dto';

@Injectable()
export class RatingsService {
  constructor(
    @InjectRepository(Rating)
    private readonly ratingRepo: Repository<Rating>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(DriverProfile)
    private readonly driverProfileRepo: Repository<DriverProfile>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async create(raterId: string, dto: CreateRatingDto) {
    const booking = await this.bookingRepo.findOne({
      where: { id: dto.booking_id },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== BookingStatus.DELIVERED) {
      throw new BadRequestException({
        code: 'BOOKING_NOT_DELIVERED',
        message: 'Can only rate completed deliveries',
      });
    }

    // Verify rater is a party on the booking
    if (booking.client_id !== raterId && booking.driver_id !== raterId) {
      throw new ForbiddenException('Access denied');
    }

    // Verify rated user is the OTHER party
    const otherParty =
      booking.client_id === raterId ? booking.driver_id : booking.client_id;
    if (dto.rated_user_id !== otherParty) {
      throw new BadRequestException({
        code: 'INVALID_RATED_USER',
        message: 'You can only rate the other party on this booking',
      });
    }

    // Check no duplicate rating
    const existing = await this.ratingRepo.findOne({
      where: { booking_id: dto.booking_id, rated_by_id: raterId },
    });
    if (existing) {
      throw new BadRequestException({
        code: 'ALREADY_RATED',
        message: 'You have already rated this booking',
      });
    }

    const rating = await this.ratingRepo.save(
      this.ratingRepo.create({
        booking_id: dto.booking_id,
        rated_by_id: raterId,
        rated_user_id: dto.rated_user_id,
        score: dto.score,
        comment: dto.comment ?? null,
      }),
    );

    // Recompute aggregates for whoever was just rated. We always update the
    // User row (works for both clients and drivers), and additionally update
    // the legacy DriverProfile.avg_rating for drivers so existing readers
    // (which prefer driver_profile.avg_rating) keep working.
    const aggregate = await this.ratingRepo
      .createQueryBuilder('r')
      .select('AVG(r.score)', 'avg')
      .addSelect('COUNT(r.id)', 'count')
      .where('r.rated_user_id = :userId', { userId: dto.rated_user_id })
      .getRawOne<{ avg: string; count: string }>();

    const avg = parseFloat(parseFloat(aggregate?.avg ?? '0').toFixed(2));
    const total = parseInt(aggregate?.count ?? '0', 10);

    await this.userRepo.update(dto.rated_user_id, {
      avg_rating: avg,
      total_ratings: total,
    });

    const driverProfile = await this.driverProfileRepo.findOne({
      where: { user_id: dto.rated_user_id },
    });
    if (driverProfile) {
      await this.driverProfileRepo.update(driverProfile.id, {
        avg_rating: avg,
      });
    }

    return rating;
  }

  async list(bookingId: string) {
    return this.ratingRepo.find({ where: { booking_id: bookingId } });
  }
}
