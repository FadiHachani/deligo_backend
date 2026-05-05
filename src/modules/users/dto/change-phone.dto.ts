import { IsString, Matches } from 'class-validator';

export class ChangePhoneRequestDto {
  @IsString()
  @Matches(/^(\+216\d{8}|\d{8})$/, {
    message: 'Phone must match Tunisian format +216XXXXXXXX or 8 digits',
  })
  new_phone: string;
}

export class ChangePhoneVerifyDto {
  @IsString()
  @Matches(/^(\+216\d{8}|\d{8})$/, {
    message: 'Phone must match Tunisian format +216XXXXXXXX or 8 digits',
  })
  new_phone: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'Code must be exactly 6 digits' })
  code: string;
}
