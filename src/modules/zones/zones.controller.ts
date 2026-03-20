import { Controller, Get, Query } from '@nestjs/common';
import { ZonesService } from './zones.service';
import { ZoneQueryDto } from './dto/zone-query.dto';

@Controller('api/zones')
export class ZonesController {
  constructor(private readonly zonesService: ZonesService) {}

  @Get('drivers')
  getNearbyDrivers(@Query() query: ZoneQueryDto) {
    return this.zonesService.getNearbyDrivers(query.lat, query.lng, query.radius);
  }

  @Get('heatmap')
  getHeatmap(@Query() query: ZoneQueryDto) {
    return this.zonesService.getHeatmap(query.lat, query.lng, query.radius ?? 3);
  }

  @Get('coverage')
  getCoverage() {
    return this.zonesService.getCoverage();
  }
}
