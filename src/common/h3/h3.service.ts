import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as h3 from 'h3-js';
import { DriverProfile } from '../../entities/driver-profile.entity';
import { DriverH3Presence } from '../../entities/driver-h3-presence.entity';
import { ApplicationStatus } from '../enums';

export const H3_RESOLUTION_FINE = 9;
export const H3_RESOLUTION_COARSE = 7;

@Injectable()
export class H3Service {
  constructor(
    @InjectRepository(DriverProfile)
    private readonly driverProfileRepo: Repository<DriverProfile>,
    @InjectRepository(DriverH3Presence)
    private readonly presenceRepo: Repository<DriverH3Presence>,
  ) {}

  latLngToH3(lat: number, lng: number, resolution: number): string {
    return h3.latLngToCell(lat, lng, resolution);
  }

  h3ToLatLng(h3Index: string): { lat: number; lng: number } {
    const [lat, lng] = h3.cellToLatLng(h3Index);
    return { lat, lng };
  }

  getKRing(h3Index: string, k: number): string[] {
    return h3.gridDisk(h3Index, k);
  }

  h3Distance(a: string, b: string): number {
    return h3.gridDistance(a, b);
  }

  h3Parent(h3Index: string, parentResolution: number): string {
    return h3.cellToParent(h3Index, parentResolution);
  }

  async getDriversInZone(
    h3Index: string,
    kRadius: number,
  ): Promise<DriverProfile[]> {
    const ring = this.getKRing(h3Index, kRadius);

    const presences = await this.presenceRepo
      .createQueryBuilder('p')
      .where('p.h3_index IN (:...ring)', { ring })
      .getMany();

    if (presences.length === 0) return [];

    const driverIds = presences.map((p) => p.driver_id);

    return this.driverProfileRepo
      .createQueryBuilder('dp')
      .where('dp.user_id IN (:...driverIds)', { driverIds })
      .andWhere('dp.is_online = true')
      .andWhere('dp.application_status = :status', {
        status: ApplicationStatus.APPROVED,
      })
      .getMany();
  }
}
