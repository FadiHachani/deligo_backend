import { IsInt, IsString, MaxLength, Min } from 'class-validator';

export class ApplyAsDriverDto {
  @IsString()
  @MaxLength(50)
  vehicle_type: string;

  @IsString()
  @MaxLength(20)
  plate_number: string;

  @IsInt()
  @Min(1)
  capacity_kg: number;
}
