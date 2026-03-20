import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtUser } from '../../common/types/jwt-user';
import { ApprovedDriverGuard } from '../../common/guards/approved-driver.guard';
import { ListBookingsDto } from './dto/list-bookings.dto';

@Controller('api/bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  list(@CurrentUser() user: JwtUser, @Query() dto: ListBookingsDto) {
    return this.bookingsService.list(user.sub, user.role, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.bookingsService.findOne(id, user.sub, user.role);
  }

  @Patch(':id/start')
  @UseGuards(ApprovedDriverGuard)
  start(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.bookingsService.start(id, user.sub);
  }

  @Patch(':id/deliver')
  @UseGuards(ApprovedDriverGuard)
  deliver(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.bookingsService.deliver(id, user.sub);
  }

  @Patch(':id/fail')
  @UseGuards(ApprovedDriverGuard)
  fail(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.bookingsService.fail(id, user.sub);
  }
}
