import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { MailService } from '../../common/mail/mail.service';
import { ContactSupportDto } from './dto/contact-support.dto';

@Injectable()
export class SupportService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly mailService: MailService,
  ) {}

  async contact(userId: string, dto: ContactSupportDto): Promise<{ message: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    try {
      await this.mailService.sendSupportRequest({
        fromName: user.full_name ?? 'Unknown user',
        fromEmail: user.email,
        fromPhone: user.phone,
        subject: dto.subject,
        message: dto.message,
      });
    } catch {
      throw new InternalServerErrorException({
        code: 'MAIL_FAILED',
        message: 'Failed to send your message. Please try again later.',
      });
    }

    return { message: 'Your message has been sent. We\'ll get back to you soon.' };
  }
}
