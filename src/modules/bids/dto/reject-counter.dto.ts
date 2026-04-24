import { IsNumber, Min } from 'class-validator';

export class RejectCounterDto {
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  driver_final_price_tnd: number;
}
