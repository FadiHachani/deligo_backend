import { IsOptional, IsString, MaxLength } from 'class-validator';

// Shared by client `cancel` and driver `fail` endpoints. Both record a
// preset code + optional free-text comment so the post-resolution screens
// can surface why the booking ended without a delivery.
export class CancelBookingDto {
  @IsString()
  @MaxLength(64)
  reason_code: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason_text?: string;
}
