import { IsString, MinLength } from 'class-validator';

export class RejectDriverDto {
  @IsString()
  @MinLength(5)
  reason: string;
}
