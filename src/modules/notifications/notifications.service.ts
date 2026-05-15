import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from '../../entities/notification.entity';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { PushService } from './push.service';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    private readonly trackingGateway: TrackingGateway,
    private readonly pushService: PushService,
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
    this.trackingGateway.emitNotificationCreated(userId, saved);
    // Fire-and-forget push. The PushService swallows errors so a failed
    // delivery never breaks the in-app notification write.
    void this.pushService.sendToUser(userId, {
      type,
      title,
      body,
      // Forward the request_id (when prefix-encoded in the body) so the
      // client's tap handler can route to the right screen without a
      // round-trip. Other ids (booking, bid) can be added the same way.
      data: extractRouteData(body),
    });
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

// Pull a request_id (or other ids, when we add them) out of the notification
// body so the push payload's `data` field can carry it to the client for
// tap-to-route. Body shape is `request_id:<uuid> · <free text>` per
// front-end/src/shared/utils/notificationBody.ts.
function extractRouteData(body: string): Record<string, string> {
  const data: Record<string, string> = {};
  const reqMatch = body.match(/^request_id:([a-f0-9-]+)/i);
  if (reqMatch) data.request_id = reqMatch[1];
  return data;
}
