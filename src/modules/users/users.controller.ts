import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UpdateUserDto } from './dto/update-user.dto';
import { ApplyAsDriverDto } from './dto/apply-driver.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/enums';
import { JwtUser } from '../../common/types/jwt-user';

@Controller('api/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: JwtUser) {
    return this.usersService.getMe(user.sub);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: JwtUser, @Body() dto: UpdateUserDto) {
    return this.usersService.updateMe(user.sub, dto);
  }

  @Post('me/apply-as-driver')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  applyAsDriver(@CurrentUser() user: JwtUser, @Body() dto: ApplyAsDriverDto) {
    return this.usersService.applyAsDriver(user.sub, dto);
  }

  @Get('me/application-status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  getApplicationStatus(@CurrentUser() user: JwtUser) {
    return this.usersService.getApplicationStatus(user.sub);
  }
}
