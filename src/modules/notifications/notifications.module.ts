import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { Notification } from '../../entities/notification.entity';
import { User } from '../../entities/user.entity';
import { TrackingModule } from '../tracking/tracking.module';

@Module({
  imports: [TypeOrmModule.forFeature([Notification, User]), TrackingModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, PushService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
