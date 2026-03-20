import { IsString, Matches } from 'class-validator';

export class RequestOtpDto {
  @IsString()
  @Matches(/^(\+216\d{8}|\d{8})$/, {
    message: 'Phone must match Tunisian format +216XXXXXXXX or 8 digits',
  })
  phone: string;
}
