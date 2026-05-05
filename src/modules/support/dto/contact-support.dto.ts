import { IsString, MaxLength, MinLength } from 'class-validator';

export class ContactSupportDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  subject: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  message: string;
}
