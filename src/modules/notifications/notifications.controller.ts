import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtUser } from '../../common/types/jwt-user';
import { ListNotificationsDto } from './dto/list-notifications.dto';

@Controller('api/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: JwtUser, @Query() dto: ListNotificationsDto) {
    return this.notificationsService.list(user.sub, dto);
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.notificationsService.markRead(id, user.sub);
  }
}
