import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';
import { DriverProfile } from '../../entities/driver-profile.entity';
import { DriverH3Presence } from '../../entities/driver-h3-presence.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DriverProfile, DriverH3Presence])],
  controllers: [DriversController],
  providers: [DriversService],
  exports: [DriversService],
})
export class DriversModule {}
