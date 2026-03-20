import { IsString, IsNumber, IsOptional, Min, Max, validateSync } from 'class-validator';
import { plainToInstance, Transform } from 'class-transformer';

class EnvironmentVariables {
  @IsString()
  DATABASE_HOST: string;

  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  DATABASE_PORT: number;

  @IsString()
  DATABASE_USER: string;

  @IsString()
  DATABASE_PASSWORD: string;

  @IsString()
  DATABASE_NAME: string;

  @IsString()
  REDIS_HOST: string;

  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  REDIS_PORT: number;

  @IsString()
  JWT_PRIVATE_KEY_PATH: string;

  @IsString()
  JWT_PUBLIC_KEY_PATH: string;

  @IsOptional()
  @IsString()
  JWT_ACCESS_TTL: string = '15m';

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  JWT_REFRESH_TTL_DAYS: number = 30;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(60)
  OTP_TTL_SECONDS: number = 300;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(10)
  OTP_COOLDOWN_SECONDS: number = 60;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsNumber()
  @Min(1)
  @Max(10)
  OTP_MAX_ATTEMPTS: number = 3;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return validatedConfig;
}
