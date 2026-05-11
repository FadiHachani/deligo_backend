import { IsEnum, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { RequestStatus } from '../../../common/enums';

export class ListRequestsDto {
  @IsOptional()
  @IsEnum(RequestStatus)
  status?: RequestStatus;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  limit: number = 20;

  // Driver-only: filter to requests near a point and sort by H3 distance.
  // When supplied, lat+lng are both required; k is the kRing radius
  // (resolution 9 ≈ ~1km per ring step). Capped server-side.
  @IsOptional()
  @Transform(({ value }) => parseFloat(value as string))
  @IsNumber()
  @IsLatitude()
  nearby_lat?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value as string))
  @IsNumber()
  @IsLongitude()
  nearby_lng?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(0)
  @Max(8)
  k: number = 2;
}
