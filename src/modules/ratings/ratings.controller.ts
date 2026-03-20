import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { RatingsService } from './ratings.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtUser } from '../../common/types/jwt-user';
import { CreateRatingDto } from './dto/create-rating.dto';

@Controller('api/ratings')
export class RatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateRatingDto) {
    return this.ratingsService.create(user.sub, dto);
  }

  @Get()
  list(@Query('booking_id') bookingId: string) {
    return this.ratingsService.list(bookingId);
  }
}
