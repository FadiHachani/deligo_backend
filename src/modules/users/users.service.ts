import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { DriverProfile } from '../../entities/driver-profile.entity';
import { UpdateUserDto } from './dto/update-user.dto';
import { ApplyAsDriverDto } from './dto/apply-driver.dto';
import { UserRole } from '../../common/enums';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(DriverProfile)
    private readonly driverProfileRepo: Repository<DriverProfile>,
  ) {}

  async getMe(userId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['driver_profile'],
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateMe(userId: string, dto: UpdateUserDto) {
    await this.userRepo.update(userId, dto);
    return this.getMe(userId);
  }

  async applyAsDriver(userId: string, dto: ApplyAsDriverDto) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.role === UserRole.DRIVER) {
      const existing = await this.driverProfileRepo.findOne({
        where: { user_id: userId },
      });
      if (existing) {
        throw new ConflictException({
          code: 'ALREADY_APPLIED',
          message: 'Driver profile already exists',
        });
      }
    }

    const profile = await this.driverProfileRepo.save(
      this.driverProfileRepo.create({
        user_id: userId,
        vehicle_type: dto.vehicle_type,
        plate_number: dto.plate_number,
        capacity_kg: dto.capacity_kg,
      }),
    );

    await this.userRepo.update(userId, { role: UserRole.DRIVER });

    console.log(`[DRIVER_APPLICATION] New application from ${user.phone}`);
    return profile;
  }

  async getApplicationStatus(userId: string) {
    const profile = await this.driverProfileRepo.findOne({
      where: { user_id: userId },
    });
    if (!profile) throw new NotFoundException('Driver profile not found');
    return {
      applicationStatus: profile.application_status,
    };
  }
}
