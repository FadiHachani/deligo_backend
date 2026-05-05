import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { SupportService } from './support.service';
import { ContactSupportDto } from './dto/contact-support.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtUser } from '../../common/types/jwt-user';

@Controller('api/support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post('contact')
  @HttpCode(HttpStatus.OK)
  contact(@CurrentUser() user: JwtUser, @Body() dto: ContactSupportDto) {
    return this.supportService.contact(user.sub, dto);
  }
}
