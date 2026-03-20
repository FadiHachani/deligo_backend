import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ZonesController } from './zones.controller';
import { ZonesService } from './zones.service';
import { DriverProfile } from '../../entities/driver-profile.entity';
import { DriverH3Presence } from '../../entities/driver-h3-presence.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DriverProfile, DriverH3Presence])],
  controllers: [ZonesController],
  providers: [ZonesService],
  exports: [ZonesService],
})
export class ZonesModule {}
