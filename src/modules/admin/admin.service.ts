import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DriverProfile } from '../../entities/driver-profile.entity';
import { ApplicationStatus } from '../../common/enums';
import { ListApplicationsDto } from './dto/list-applications.dto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(DriverProfile)
    private readonly driverProfileRepo: Repository<DriverProfile>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async listApplications(dto: ListApplicationsDto) {
    const { status, page, limit } = dto;
    const qb = this.driverProfileRepo
      .createQueryBuilder('dp')
      .leftJoinAndSelect('dp.user', 'user')
      .orderBy('dp.applied_at', 'DESC');

    if (status) {
      qb.where('dp.application_status = :status', { status });
    }

    const total = await qb.getCount();
    const items = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return { items, total, page, limit };
  }

  async approveDriver(driverId: string, adminId: string) {
    const profile = await this.driverProfileRepo.findOne({
      where: { id: driverId },
    });
    if (!profile) throw new NotFoundException('Driver profile not found');

    profile.application_status = ApplicationStatus.APPROVED;
    profile.approved_at = new Date();
    profile.approved_by = adminId;
    await this.driverProfileRepo.save(profile);

    console.log(`[ADMIN] Driver ${driverId} approved`);
    await this.notificationsService.create(
      profile.user_id,
      'APPLICATION_APPROVED',
      'Your driver application is approved',
      `Congratulations! Your driver application has been approved.`,
    );
    return profile;
  }

  async rejectDriver(driverId: string, reason: string, adminId: string) {
    const profile = await this.driverProfileRepo.findOne({
      where: { id: driverId },
    });
    if (!profile) throw new NotFoundException('Driver profile not found');

    profile.application_status = ApplicationStatus.REJECTED;
    await this.driverProfileRepo.save(profile);

    console.log(`[ADMIN] Driver ${driverId} rejected: ${reason}`);
    await this.notificationsService.create(
      profile.user_id,
      'APPLICATION_REJECTED',
      'Your driver application was rejected',
      `Your driver application was rejected. Reason: ${reason}`,
    );
    return profile;
  }
}
