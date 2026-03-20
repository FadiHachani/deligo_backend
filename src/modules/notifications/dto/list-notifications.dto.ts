import { IsInt, IsOptional, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class ListNotificationsDto {
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
}
