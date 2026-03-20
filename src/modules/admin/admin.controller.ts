import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/enums';
import { ListApplicationsDto } from './dto/list-applications.dto';
import { RejectDriverDto } from './dto/reject-driver.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtUser } from '../../common/types/jwt-user';

@Controller('api/admin')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('driver-applications')
  listApplications(@Query() dto: ListApplicationsDto) {
    return this.adminService.listApplications(dto);
  }

  @Patch('driver-applications/:driverId/approve')
  approveDriver(
    @Param('driverId') driverId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.adminService.approveDriver(driverId, user.sub);
  }

  @Patch('driver-applications/:driverId/reject')
  rejectDriver(
    @Param('driverId') driverId: string,
    @Body() dto: RejectDriverDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.adminService.rejectDriver(driverId, dto.reason, user.sub);
  }
}
