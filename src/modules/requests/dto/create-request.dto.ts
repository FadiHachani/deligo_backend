import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const toFloat = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? parseFloat(value) : (value as number);

export class CreateRequestDto {
  @Transform(toFloat)
  @IsNumber()
  @Min(-90)
  @Max(90)
  pickup_lat: number;

  @Transform(toFloat)
  @IsNumber()
  @Min(-180)
  @Max(180)
  pickup_lng: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  pickup_address?: string;

  @Transform(toFloat)
  @IsNumber()
  @Min(-90)
  @Max(90)
  dropoff_lat: number;

  @Transform(toFloat)
  @IsNumber()
  @Min(-180)
  @Max(180)
  dropoff_lng: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  dropoff_address?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(50)
  item_category: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  description: string;

  @IsOptional()
  @IsDateString()
  scheduled_at?: string;
}
