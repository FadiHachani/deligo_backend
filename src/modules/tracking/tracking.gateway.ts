import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { Booking } from '../../entities/booking.entity';
import { DriverProfile } from '../../entities/driver-profile.entity';
import { DriverH3Presence } from '../../entities/driver-h3-presence.entity';
import { TrackingEvent } from '../../entities/tracking-event.entity';
import { BookingStatus, UserRole } from '../../common/enums';
import { H3Service, H3_RESOLUTION_FINE } from '../../common/h3/h3.service';
import { JwtUser } from '../../common/types/jwt-user';

interface LocationUpdatePayload {
  bookingId: string;
  lat: number;
  lng: number;
  heading?: number;
}

interface JoinLeavePayload {
  bookingId: string;
}

@WebSocketGateway({ namespace: '/tracking', cors: { origin: '*' } })
export class TrackingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly publicKey: Buffer;

  constructor(
    private readonly jwtService: JwtService,
    private readonly h3Service: H3Service,
    private readonly configService: ConfigService,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(DriverProfile)
    private readonly driverProfileRepo: Repository<DriverProfile>,
    @InjectRepository(DriverH3Presence)
    private readonly presenceRepo: Repository<DriverH3Presence>,
    @InjectRepository(TrackingEvent)
    private readonly trackingEventRepo: Repository<TrackingEvent>,
  ) {
    const publicKeyPath = this.configService.get<string>('JWT_PUBLIC_KEY_PATH')!;
    this.publicKey = fs.readFileSync(path.resolve(publicKeyPath));
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth as Record<string, string>)['token'] ||
        client.handshake.headers['authorization']?.replace('Bearer ', '');

      if (!token) throw new Error('No token');

      const payload = this.jwtService.verify<JwtUser>(token, {
        algorithms: ['RS256'],
        publicKey: this.publicKey,
      });

      (client as Socket & { user: JwtUser }).user = payload;
      await client.join(`user:${payload.sub}`);
      console.log(`[WS] Client connected: ${client.id} (${payload.sub})`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    console.log(`[WS] Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join_booking')
  async handleJoinBooking(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinLeavePayload,
  ) {
    const user = (client as Socket & { user: JwtUser }).user;
    if (!user) throw new WsException('Unauthorized');

    const booking = await this.bookingRepo.findOne({
      where: { id: payload.bookingId },
    });
    if (!booking) throw new WsException('Booking not found');

    if (
      booking.client_id !== user.sub &&
      booking.driver_id !== user.sub
    ) {
      throw new WsException('Access denied');
    }

    await client.join(`booking:${payload.bookingId}`);
    return { event: 'joined', bookingId: payload.bookingId };
  }

  @SubscribeMessage('leave_booking')
  async handleLeaveBooking(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinLeavePayload,
  ) {
    await client.leave(`booking:${payload.bookingId}`);
    return { event: 'left', bookingId: payload.bookingId };
  }

  @SubscribeMessage('location_update')
  async handleLocationUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: LocationUpdatePayload,
  ) {
    const user = (client as Socket & { user: JwtUser }).user;
    if (!user || user.role !== UserRole.DRIVER) {
      throw new WsException('Driver access required');
    }

    const booking = await this.bookingRepo.findOne({
      where: { id: payload.bookingId },
    });
    if (!booking || booking.status !== BookingStatus.IN_TRANSIT) {
      throw new WsException('Booking is not in transit');
    }
    if (booking.driver_id !== user.sub) {
      throw new WsException('Access denied');
    }

    const h3Index = this.h3Service.latLngToH3(
      payload.lat,
      payload.lng,
      H3_RESOLUTION_FINE,
    );

    // Insert tracking event
    await this.trackingEventRepo.save(
      this.trackingEventRepo.create({
        booking_id: payload.bookingId,
        lat: payload.lat,
        lng: payload.lng,
        h3_index: h3Index,
      }),
    );

    // Upsert driver presence
    await this.presenceRepo
      .createQueryBuilder()
      .insert()
      .into(DriverH3Presence)
      .values({
        driver_id: user.sub,
        h3_index: h3Index,
        resolution: H3_RESOLUTION_FINE,
      })
      .orUpdate(['h3_index', 'resolution', 'updated_at'], ['driver_id'])
      .execute();

    // Update driver profile
    await this.driverProfileRepo.update(
      { user_id: user.sub },
      { current_lat: payload.lat, current_lng: payload.lng, current_h3_index: h3Index },
    );

    const broadcastPayload = {
      lat: payload.lat,
      lng: payload.lng,
      heading: payload.heading ?? null,
      h3_index: h3Index,
      timestamp: new Date().toISOString(),
    };

    this.server
      .to(`booking:${payload.bookingId}`)
      .emit('location_broadcast', broadcastPayload);

    return broadcastPayload;
  }

  emitBookingStatusChanged(
    bookingId: string,
    status: BookingStatus,
  ): void {
    this.server.to(`booking:${bookingId}`).emit('booking_status_changed', {
      bookingId,
      status,
      timestamp: new Date().toISOString(),
    });
  }

  emitNotificationCreated(userId: string, notification: unknown): void {
    this.server.to(`user:${userId}`).emit('notification_created', notification);
  }
}
