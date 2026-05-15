import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UsersService } from './users.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UpdateUserDto } from './dto/update-user.dto';
import { ApplyAsDriverDto } from './dto/apply-driver.dto';
import { ChangePhoneRequestDto, ChangePhoneVerifyDto } from './dto/change-phone.dto';
import { SetPushTokenDto } from './dto/push-token.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/enums';
import { JwtUser } from '../../common/types/jwt-user';

@Controller('api/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: JwtUser) {
    return this.usersService.getMe(user.sub);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: JwtUser, @Body() dto: UpdateUserDto) {
    return this.usersService.updateMe(user.sub, dto);
  }

  // Register the device's Expo push token. Clients call this on cold start
  // after permission is granted; passing null clears the token on logout.
  @Post('me/push-token')
  setPushToken(@CurrentUser() user: JwtUser, @Body() dto: SetPushTokenDto) {
    return this.usersService.setPushToken(user.sub, dto.token ?? null);
  }

  @Post('me/apply-as-driver')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  applyAsDriver(@CurrentUser() user: JwtUser, @Body() dto: ApplyAsDriverDto) {
    return this.usersService.applyAsDriver(user.sub, dto);
  }

  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('avatar', { storage: undefined }))
  uploadAvatar(
    @CurrentUser() user: JwtUser,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.usersService.uploadAvatar(user.sub, file);
  }

  @Post('me/phone/otp/request')
  requestPhoneChangeOtp(@CurrentUser() user: JwtUser, @Body() dto: ChangePhoneRequestDto) {
    return this.usersService.requestPhoneChangeOtp(user.sub, dto.new_phone);
  }

  @Post('me/phone/otp/verify')
  verifyPhoneChangeOtp(@CurrentUser() user: JwtUser, @Body() dto: ChangePhoneVerifyDto) {
    return this.usersService.verifyPhoneChangeOtp(user.sub, dto.new_phone, dto.code);
  }

  @Get('me/application-status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.DRIVER)
  getApplicationStatus(@CurrentUser() user: JwtUser) {
    return this.usersService.getApplicationStatus(user.sub);
  }
}
