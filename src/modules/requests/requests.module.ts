import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { TransportRequest } from '../../entities/transport-request.entity';
import { DriverProfile } from '../../entities/driver-profile.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TransportRequest, DriverProfile])],
  controllers: [RequestsController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
