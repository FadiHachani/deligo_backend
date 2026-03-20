import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { RequestsService } from './requests.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtUser } from '../../common/types/jwt-user';
import { CreateRequestDto } from './dto/create-request.dto';
import { ListRequestsDto } from './dto/list-requests.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/enums';
import { UseGuards } from '@nestjs/common';

@Controller('api/requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateRequestDto) {
    return this.requestsService.create(user.sub, dto);
  }

  @Get()
  list(@CurrentUser() user: JwtUser, @Query() dto: ListRequestsDto) {
    return this.requestsService.list(user.sub, user.role, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.requestsService.findOne(id, user.sub, user.role);
  }

  @Patch(':id/cancel')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  cancel(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.requestsService.cancel(id, user.sub);
  }
}
