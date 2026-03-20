import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class ZoneQueryDto {
  @Transform(({ value }) => parseFloat(value as string))
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @Transform(({ value }) => parseFloat(value as string))
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsNumber()
  @Min(0)
  @Max(10)
  radius: number = 2;
}
