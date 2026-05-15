import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SetPushTokenDto {
  // null is a valid value (clears the token on logout). class-validator
  // permits null through @IsOptional + the union type at the column level.
  @IsOptional()
  @IsString()
  @MaxLength(255)
  token: string | null;
}
