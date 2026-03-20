import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { H3Service } from './h3.service';
import { DriverProfile } from '../../entities/driver-profile.entity';
import { DriverH3Presence } from '../../entities/driver-h3-presence.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([DriverProfile, DriverH3Presence])],
  providers: [H3Service],
  exports: [H3Service],
})
export class H3Module {}
