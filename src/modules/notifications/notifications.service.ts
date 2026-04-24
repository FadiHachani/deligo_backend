import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from '../../entities/notification.entity';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import type { TrackingGateway } from '../tracking/tracking.gateway';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @Optional() private readonly trackingGateway: TrackingGateway | null = null,
  ) {}

  async create(
    userId: string,
    type: string,
    title: string,
    body: string,
  ): Promise<Notification> {
    console.log(`[NOTIFICATION] [${type}] → user ${userId}: ${title}`);
    const notification = this.notificationRepo.create({
      user_id: userId,
      type,
      title,
      body,
    });
    const saved = await this.notificationRepo.save(notification);
    console.log(`[NOTIFICATION] gateway available: ${!!this.trackingGateway}, emitting to user:${userId}`);
    this.trackingGateway?.emitNotificationCreated(userId, saved);
    return saved;
  }

  async list(userId: string, dto: ListNotificationsDto) {
    const { page, limit } = dto;
    const [items, total] = await this.notificationRepo.findAndCount({
      where: { user_id: userId },
      order: { sent_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total, page, limit };
  }

  async markRead(notificationId: string, userId: string) {
    const notification = await this.notificationRepo.findOne({
      where: { id: notificationId },
    });
    if (!notification) throw new NotFoundException('Notification not found');
    if (notification.user_id !== userId)
      throw new ForbiddenException('Access denied');

    notification.is_read = true;
    return this.notificationRepo.save(notification);
  }
}
