import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { User } from '../../entities/user.entity';

// Thin wrapper around the Expo push HTTP API. We fan out one push per
// in-app notification, matching the type/title/body so the user gets a
// consistent experience whether the app is open or backgrounded.
//
// Tokens that come back as DeviceNotRegistered are cleared from the user
// row — they'd otherwise generate failure tickets on every send forever.
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly expo: Expo;

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    configService: ConfigService,
  ) {
    // accessToken is optional. When set, Expo enforces per-account quotas
    // and protects against spoofed pushes from other accounts using your
    // project's tokens. See EXPO_ACCESS_TOKEN in your deployment env.
    this.expo = new Expo({
      accessToken: configService.get<string>('EXPO_ACCESS_TOKEN'),
    });
  }

  // Fire-and-forget. Logs but never throws — push delivery must not break
  // the in-app notification write that prompted it.
  async sendToUser(
    userId: string,
    payload: {
      type: string;
      title: string;
      body: string;
      data?: Record<string, unknown>;
    },
  ): Promise<void> {
    try {
      const user = await this.userRepo.findOne({
        where: { id: userId },
        select: ['id', 'push_token'],
      });
      const token = user?.push_token;
      if (!token) return;
      if (!Expo.isExpoPushToken(token)) {
        this.logger.warn(
          `Invalid Expo token for user ${userId}; clearing it.`,
        );
        await this.userRepo.update(userId, { push_token: null });
        return;
      }

      const message: ExpoPushMessage = {
        to: token,
        sound: 'default',
        title: payload.title,
        body: payload.body,
        // `priority: 'high'` bypasses Android Doze for time-sensitive events
        // (new bid, booking confirmed) so the user is paged immediately.
        priority: 'high',
        // The client reads `data.type` (+ optional ids) on tap to route the
        // user to the right screen without needing to fetch.
        data: { type: payload.type, ...(payload.data ?? {}) },
      };

      const chunks = this.expo.chunkPushNotifications([message]);
      const tickets: ExpoPushTicket[] = [];
      for (const chunk of chunks) {
        try {
          const chunkTickets = await this.expo.sendPushNotificationsAsync(chunk);
          tickets.push(...chunkTickets);
        } catch (err) {
          this.logger.error(`Expo push send failed: ${(err as Error).message}`);
        }
      }

      // Drop tokens the device manager has revoked so they don't fail
      // forever. Other ticket errors (RateExceeded, MessageTooBig) are
      // transient or our fault — log and move on.
      for (const ticket of tickets) {
        if (ticket.status === 'error') {
          const errCode = ticket.details?.error;
          if (errCode === 'DeviceNotRegistered') {
            this.logger.warn(
              `Push token for user ${userId} no longer registered; clearing.`,
            );
            await this.userRepo.update(userId, { push_token: null });
          } else {
            this.logger.warn(`Push ticket error (${errCode}): ${ticket.message}`);
          }
        }
      }
    } catch (err) {
      this.logger.error(`PushService.sendToUser failed: ${(err as Error).message}`);
    }
  }
}
