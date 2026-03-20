import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { DriverProfile } from '../../entities/driver-profile.entity';
import { ApplicationStatus, UserRole } from '../enums';
import { JwtUser } from '../types/jwt-user';

@Injectable()
export class ApprovedDriverGuard implements CanActivate {
  constructor(
    @InjectRepository(DriverProfile)
    private readonly driverProfileRepo: Repository<DriverProfile>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as Request & { user: JwtUser }).user;

    if (!user || user.role !== UserRole.DRIVER) {
      throw new ForbiddenException('Driver access required');
    }

    const profile = await this.driverProfileRepo.findOne({
      where: { user_id: user.sub },
    });

    if (!profile || profile.application_status !== ApplicationStatus.APPROVED) {
      throw new ForbiddenException('Driver application not approved');
    }

    return true;
  }
}
