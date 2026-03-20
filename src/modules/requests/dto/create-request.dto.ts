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

export class CreateRequestDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  pickup_lat: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  pickup_lng: number;

  @IsNumber()
  @Min(-90)
  @Max(90)
  dropoff_lat: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  dropoff_lng: number;

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
