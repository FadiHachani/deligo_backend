import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RatingsController } from './ratings.controller';
import { RatingsService } from './ratings.service';
import { Rating } from '../../entities/rating.entity';
import { Booking } from '../../entities/booking.entity';
import { DriverProfile } from '../../entities/driver-profile.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Rating, Booking, DriverProfile])],
  controllers: [RatingsController],
  providers: [RatingsService],
  exports: [RatingsService],
})
export class RatingsModule {}
