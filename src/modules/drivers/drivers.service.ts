import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DriverProfile } from '../../entities/driver-profile.entity';
import { DriverH3Presence } from '../../entities/driver-h3-presence.entity';
import { H3Service, H3_RESOLUTION_FINE } from '../../common/h3/h3.service';
import { UpdateDriverStatusDto } from './dto/update-status.dto';

@Injectable()
export class DriversService {
  constructor(
    @InjectRepository(DriverProfile)
    private readonly driverProfileRepo: Repository<DriverProfile>,
    @InjectRepository(DriverH3Presence)
    private readonly presenceRepo: Repository<DriverH3Presence>,
    private readonly h3Service: H3Service,
  ) {}

  async updateStatus(userId: string, dto: UpdateDriverStatusDto) {
    const profile = await this.driverProfileRepo.findOne({
      where: { user_id: userId },
    });
    if (!profile) throw new NotFoundException('Driver profile not found');

    profile.is_online = dto.is_online;

    if (dto.is_online) {
      if (dto.lat === undefined || dto.lng === undefined) {
        throw new BadRequestException({
          code: 'LOCATION_REQUIRED',
          message: 'lat and lng are required when going online',
        });
      }
      profile.current_lat = dto.lat;
      profile.current_lng = dto.lng;
      profile.current_h3_index = this.h3Service.latLngToH3(
        dto.lat,
        dto.lng,
        H3_RESOLUTION_FINE,
      );

      await this.presenceRepo
        .createQueryBuilder()
        .insert()
        .into(DriverH3Presence)
        .values({
          driver_id: userId,
          h3_index: profile.current_h3_index,
          resolution: H3_RESOLUTION_FINE,
        })
        .orUpdate(['h3_index', 'resolution', 'updated_at'], ['driver_id'])
        .execute();
    } else {
      await this.presenceRepo.delete({ driver_id: userId });
    }

    await this.driverProfileRepo.save(profile);
    return profile;
  }
}
