import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateDriverStatusDto {
  @IsBoolean()
  is_online: boolean;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;
}
