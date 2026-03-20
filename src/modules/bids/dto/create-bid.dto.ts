import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBidDto {
  @IsUUID()
  request_id: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  price_tnd: number;

  @IsInt()
  @Min(1)
  @Max(600)
  eta_minutes: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
