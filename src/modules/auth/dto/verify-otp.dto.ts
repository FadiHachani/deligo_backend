import { IsString, Length, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  @Matches(/^(\+216\d{8}|\d{8})$/, {
    message: 'Phone must match Tunisian format +216XXXXXXXX or 8 digits',
  })
  phone: string;

  @IsString()
  @Length(6, 6, { message: 'OTP code must be exactly 6 digits' })
  @Matches(/^\d{6}$/, { message: 'OTP code must be numeric' })
  code: string;
}
