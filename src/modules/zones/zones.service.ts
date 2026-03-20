import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { H3Service, H3_RESOLUTION_COARSE, H3_RESOLUTION_FINE } from '../../common/h3/h3.service';
import { DriverProfile } from '../../entities/driver-profile.entity';
import { DriverH3Presence } from '../../entities/driver-h3-presence.entity';
import { ApplicationStatus } from '../../common/enums';

@Injectable()
export class ZonesService {
  constructor(
    private readonly h3Service: H3Service,
    @InjectRepository(DriverProfile)
    private readonly driverProfileRepo: Repository<DriverProfile>,
    @InjectRepository(DriverH3Presence)
    private readonly presenceRepo: Repository<DriverH3Presence>,
  ) {}

  async getNearbyDrivers(lat: number, lng: number, radius: number) {
    const centerH3 = this.h3Service.latLngToH3(lat, lng, H3_RESOLUTION_FINE);
    const ring = this.h3Service.getKRing(centerH3, radius);

    const presences = await this.presenceRepo
      .createQueryBuilder('p')
      .where('p.h3_index IN (:...ring)', { ring })
      .getMany();

    if (presences.length === 0) return [];

    const driverIds = presences.map((p) => p.driver_id);
    const profiles = await this.driverProfileRepo
      .createQueryBuilder('dp')
      .where('dp.user_id IN (:...driverIds)', { driverIds })
      .andWhere('dp.is_online = true')
      .andWhere('dp.application_status = :status', {
        status: ApplicationStatus.APPROVED,
      })
      .getMany();

    return profiles.map((dp) => ({
      driver_id: dp.user_id,
      current_lat: dp.current_lat,
      current_lng: dp.current_lng,
      h3_index: dp.current_h3_index,
      vehicle_type: dp.vehicle_type,
      avg_rating: dp.avg_rating,
    }));
  }

  async getHeatmap(lat: number, lng: number, radius: number) {
    const centerH3 = this.h3Service.latLngToH3(lat, lng, H3_RESOLUTION_COARSE);
    const ring = this.h3Service.getKRing(centerH3, radius);

    const profiles = await this.driverProfileRepo
      .createQueryBuilder('dp')
      .where('dp.is_online = true')
      .andWhere('dp.application_status = :status', {
        status: ApplicationStatus.APPROVED,
      })
      .andWhere('dp.current_h3_index IS NOT NULL')
      .getMany();

    const countMap = new Map<string, number>();

    for (const profile of profiles) {
      if (!profile.current_h3_index) continue;
      try {
        const parent = this.h3Service.h3Parent(
          profile.current_h3_index,
          H3_RESOLUTION_COARSE,
        );
        if (ring.includes(parent)) {
          countMap.set(parent, (countMap.get(parent) ?? 0) + 1);
        }
      } catch {
        // skip invalid h3 indices
      }
    }

    return ring.map((h3Index) => {
      const { lat: cLat, lng: cLng } = this.h3Service.h3ToLatLng(h3Index);
      return {
        h3_index: h3Index,
        driver_count: countMap.get(h3Index) ?? 0,
        center_lat: cLat,
        center_lng: cLng,
      };
    });
  }

  async getCoverage() {
    const profiles = await this.driverProfileRepo
      .createQueryBuilder('dp')
      .where('dp.is_online = true')
      .andWhere('dp.application_status = :status', {
        status: ApplicationStatus.APPROVED,
      })
      .andWhere('dp.current_h3_index IS NOT NULL')
      .getMany();

    const countMap = new Map<string, number>();

    for (const profile of profiles) {
      if (!profile.current_h3_index) continue;
      try {
        const parent = this.h3Service.h3Parent(
          profile.current_h3_index,
          H3_RESOLUTION_COARSE,
        );
        countMap.set(parent, (countMap.get(parent) ?? 0) + 1);
      } catch {
        // skip
      }
    }

    return Array.from(countMap.entries()).map(([h3Index, driver_count]) => {
      const { lat: cLat, lng: cLng } = this.h3Service.h3ToLatLng(h3Index);
      return {
        h3_index: h3Index,
        driver_count,
        center_lat: cLat,
        center_lng: cLng,
      };
    });
  }
}
