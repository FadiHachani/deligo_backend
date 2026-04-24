import { IsNumber, Min } from 'class-validator';

export class CounterBidDto {
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  counter_price_tnd: number;
}
