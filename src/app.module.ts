import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { validate } from './config/env.validation';
import { RedisModule } from './redis/redis.module';
import { H3Module } from './common/h3/h3.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AdminModule } from './modules/admin/admin.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { ZonesModule } from './modules/zones/zones.module';
import { RequestsModule } from './modules/requests/requests.module';
import { BidsModule } from './modules/bids/bids.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { RatingsModule } from './modules/ratings/ratings.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import {
  User,
  DriverProfile,
  OtpToken,
  RefreshToken,
  TransportRequest,
  Bid,
  Booking,
  TrackingEvent,
  DriverH3Presence,
  Rating,
  Notification,
} from './entities';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    TypeOrmModule.forRootAsync({
      useFactory: (configService: ConfigService) => {
        const logger = new Logger('TypeORM');
        logger.warn(
          'TypeORM synchronize is enabled — disable this in production!',
        );
        return {
          type: 'postgres',
          host: configService.get<string>('DATABASE_HOST'),
          port: configService.get<number>('DATABASE_PORT'),
          username: configService.get<string>('DATABASE_USER'),
          password: configService.get<string>('DATABASE_PASSWORD'),
          database: configService.get<string>('DATABASE_NAME'),
          entities: [
            User,
            DriverProfile,
            OtpToken,
            RefreshToken,
            TransportRequest,
            Bid,
            Booking,
            TrackingEvent,
            DriverH3Presence,
            Rating,
            Notification,
          ],
          synchronize: true,
        };
      },
      inject: [ConfigService],
    }),
    RedisModule,
    H3Module,
    AuthModule,
    UsersModule,
    AdminModule,
    DriversModule,
    ZonesModule,
    RequestsModule,
    BidsModule,
    BookingsModule,
    TrackingModule,
    RatingsModule,
    NotificationsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
