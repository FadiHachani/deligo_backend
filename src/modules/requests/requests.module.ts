import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { TransportRequest } from '../../entities/transport-request.entity';
import { DriverProfile } from '../../entities/driver-profile.entity';
import { UploadModule } from '../../common/upload/upload.module';

@Module({
  imports: [TypeOrmModule.forFeature([TransportRequest, DriverProfile]), UploadModule],
  controllers: [RequestsController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
