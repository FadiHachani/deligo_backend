import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { RequestsService } from './requests.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtUser } from '../../common/types/jwt-user';
import { CreateRequestDto } from './dto/create-request.dto';
import { ListRequestsDto } from './dto/list-requests.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/enums';

@Controller('api/requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  @UseInterceptors(FilesInterceptor('photos', 5, { storage: undefined }))
  create(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateRequestDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files || files.length < 2) {
      throw new BadRequestException('At least 2 item photos are required');
    }
    if (files.length > 5) {
      throw new BadRequestException('Maximum 5 photos allowed');
    }
    const maxSize = 5 * 1024 * 1024;
    const allowedTypes = /^image\/(jpeg|png|webp)$/;
    for (const file of files) {
      if (file.size > maxSize) {
        throw new BadRequestException(`File "${file.originalname}" exceeds 5MB limit`);
      }
      if (!allowedTypes.test(file.mimetype)) {
        throw new BadRequestException(`File "${file.originalname}" must be JPEG, PNG, or WebP`);
      }
    }
    return this.requestsService.create(user.sub, dto, files);
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

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.CLIENT)
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.requestsService.delete(id, user.sub);
  }
}
