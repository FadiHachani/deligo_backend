import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { User } from '../../entities/user.entity';
import { MailModule } from '../../common/mail/mail.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), MailModule],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
