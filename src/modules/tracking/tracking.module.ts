import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { TrackingGateway } from './tracking.gateway';
import { Booking } from '../../entities/booking.entity';
import { DriverProfile } from '../../entities/driver-profile.entity';
import { DriverH3Presence } from '../../entities/driver-h3-presence.entity';
import { TrackingEvent } from '../../entities/tracking-event.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Booking,
      DriverProfile,
      DriverH3Presence,
      TrackingEvent,
    ]),
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService) => {
        const privateKeyPath = configService.get<string>('JWT_PRIVATE_KEY_PATH')!;
        const privateKey = fs.readFileSync(path.resolve(privateKeyPath));
        return {
          privateKey,
          signOptions: { algorithm: 'RS256' },
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [TrackingGateway],
  exports: [TrackingGateway],
})
export class TrackingModule {}
