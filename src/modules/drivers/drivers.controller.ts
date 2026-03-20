import { Body, Controller, Patch, UseGuards } from '@nestjs/common';
import { DriversService } from './drivers.service';
import { ApprovedDriverGuard } from '../../common/guards/approved-driver.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtUser } from '../../common/types/jwt-user';
import { UpdateDriverStatusDto } from './dto/update-status.dto';

@Controller('api/drivers')
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @Patch('me/status')
  @UseGuards(ApprovedDriverGuard)
  updateStatus(
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateDriverStatusDto,
  ) {
    return this.driversService.updateStatus(user.sub, dto);
  }
}
