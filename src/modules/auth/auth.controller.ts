import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { Public } from './decorators/public.decorator';

@Public()
@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register/otp/request')
  requestRegisterOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestRegisterOtp(dto.phone);
  }

  @Post('register/otp/verify')
  verifyRegisterOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyRegisterOtp(dto.phone, dto.code, dto.full_name, dto.email);
  }

  @Post('login/otp/request')
  requestLoginOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestLoginOtp(dto.phone);
  }

  @Post('login/otp/verify')
  verifyLoginOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyLoginOtp(dto.phone, dto.code);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }
}
