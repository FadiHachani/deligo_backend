import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BookingsService } from './bookings.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtUser } from '../../common/types/jwt-user';
import { ApprovedDriverGuard } from '../../common/guards/approved-driver.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/enums';
import { ListBookingsDto } from './dto/list-bookings.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';

// Single proof-or-confirmation photo validators. Drivers and clients both
// hit upload endpoints with one image; constraints match the item-photo
// limits used during request creation.
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_MIME = /^image\/(jpeg|png|webp)$/;

function assertValidPhoto(file: Express.Multer.File) {
  if (!file) {
    throw new BadRequestException('Photo is required');
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new BadRequestException('File exceeds 5MB limit');
  }
  if (!PHOTO_MIME.test(file.mimetype)) {
    throw new BadRequestException('File must be JPEG, PNG, or WebP');
  }
}

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
  @UseInterceptors(FileInterceptor('photo', { storage: undefined }))
  deliver(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    assertValidPhoto(file);
    return this.bookingsService.deliver(id, user.sub, file);
  }

  // Client-side counterpart: confirm receipt with their own photo. Only the
  // CLIENT role may call this; the route handler additionally checks that
  // the user is the booking's actual client.
  @Patch(':id/confirm-delivery')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  @UseInterceptors(FileInterceptor('photo', { storage: undefined }))
  confirmDelivery(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @UploadedFile() file: Express.Multer.File,
  ) {
    assertValidPhoto(file);
    return this.bookingsService.confirmDelivery(id, user.sub, file);
  }

  @Patch(':id/fail')
  @UseGuards(ApprovedDriverGuard)
  fail(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: CancelBookingDto,
  ) {
    return this.bookingsService.fail(id, user.sub, {
      code: dto.reason_code,
      text: dto.reason_text,
    });
  }

  // Client backs out post-booking, pre-transit. Reason is required so the
  // driver gets meaningful feedback and we can aggregate cancellation
  // causes for product analytics.
  @Patch(':id/cancel')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: CancelBookingDto,
  ) {
    return this.bookingsService.cancel(id, user.sub, {
      code: dto.reason_code,
      text: dto.reason_text,
    });
  }
}
