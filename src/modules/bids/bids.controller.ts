import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { BidsService } from './bids.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtUser } from '../../common/types/jwt-user';
import { ApprovedDriverGuard } from '../../common/guards/approved-driver.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/enums';
import { CreateBidDto } from './dto/create-bid.dto';
import { ListBidsDto } from './dto/list-bids.dto';
import { CounterBidDto } from './dto/counter-bid.dto';
import { RejectCounterDto } from './dto/reject-counter.dto';

@Controller('api/bids')
export class BidsController {
  constructor(private readonly bidsService: BidsService) {}

  @Post()
  @UseGuards(ApprovedDriverGuard)
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateBidDto) {
    return this.bidsService.create(user.sub, dto);
  }

  @Get()
  list(@CurrentUser() user: JwtUser, @Query() dto: ListBidsDto) {
    return this.bidsService.list(user.sub, user.role, dto.request_id);
  }

  @Post(':id/accept')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  accept(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.bidsService.accept(id, user.sub);
  }

  @Post(':id/reject')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  reject(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.bidsService.reject(id, user.sub);
  }

  @Post(':id/withdraw')
  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  withdraw(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.bidsService.withdraw(id, user.sub);
  }

  // Client counters a driver's bid with their own price.
  @Post(':id/counter')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  counter(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: CounterBidDto,
  ) {
    return this.bidsService.clientCounter(id, user.sub, dto);
  }

  // Driver accepts the client's counter — triggers the full accept flow.
  @Post(':id/accept-counter')
  @UseGuards(ApprovedDriverGuard)
  acceptCounter(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.bidsService.driverAcceptCounter(id, user.sub);
  }

  // Driver rejects the client's counter and proposes a final price.
  @Post(':id/reject-counter')
  @UseGuards(ApprovedDriverGuard)
  rejectCounter(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: RejectCounterDto,
  ) {
    return this.bidsService.driverRejectCounter(id, user.sub, dto);
  }

  // Client accepts the driver's final price (after COUNTERED_BY_DRIVER).
  @Post(':id/accept-driver-final')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  acceptDriverFinal(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.bidsService.clientAcceptDriverFinal(id, user.sub);
  }
}
