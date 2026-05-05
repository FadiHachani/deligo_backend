import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import Redis from 'ioredis';
import { User } from '../../entities/user.entity';
import { DriverProfile } from '../../entities/driver-profile.entity';
import { OtpToken } from '../../entities/otp-token.entity';
import { UpdateUserDto } from './dto/update-user.dto';
import { ApplyAsDriverDto } from './dto/apply-driver.dto';
import { UserRole } from '../../common/enums';
import { UploadService } from '../../common/upload/upload.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class UsersService {
  private static readonly HOURLY_CAP = 20;
  private static readonly HOUR_MS = 60 * 60 * 1000;

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(DriverProfile)
    private readonly driverProfileRepo: Repository<DriverProfile>,
    @InjectRepository(OtpToken)
    private readonly otpRepo: Repository<OtpToken>,
    private readonly uploadService: UploadService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {}

  async getMe(userId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['driver_profile'],
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateMe(userId: string, dto: UpdateUserDto) {
    await this.userRepo.update(userId, dto);
    return this.getMe(userId);
  }

  async uploadAvatar(userId: string, file: Express.Multer.File) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.avatar_url) {
      this.uploadService.deleteFile(user.avatar_url);
    }

    const avatarUrl = await this.uploadService.compressAndSaveAvatar(file);
    await this.userRepo.update(userId, { avatar_url: avatarUrl });

    return { avatar_url: avatarUrl };
  }

  // ─── Phone change ─────────────────────────────────────────────────────────

  private static readonly PHONE_CHANGE_COOLDOWN_DAYS = 15;

  private checkPhoneChangeCooldown(user: { phone_changed_at: Date | null }): void {
    if (!user.phone_changed_at) return;
    const cooldownMs = UsersService.PHONE_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    const availableAt = new Date(user.phone_changed_at.getTime() + cooldownMs);
    if (availableAt > new Date()) {
      throw new HttpException(
        {
          code: 'PHONE_CHANGE_COOLDOWN',
          message: `You can only change your phone number once every ${UsersService.PHONE_CHANGE_COOLDOWN_DAYS} days.`,
          available_at: availableAt.toISOString(),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async requestPhoneChangeOtp(userId: string, newPhone: string): Promise<{ message: string; expiresIn: number }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    this.checkPhoneChangeCooldown(user);

    if (user.phone === newPhone) {
      throw new ConflictException({
        code: 'SAME_PHONE',
        message: 'New phone number is the same as the current one.',
      });
    }

    const taken = await this.userRepo.findOne({ where: { phone: newPhone } });
    if (taken) {
      throw new ConflictException({
        code: 'PHONE_TAKEN',
        message: 'This phone number is already in use.',
      });
    }

    await this.checkHourlyCap(newPhone);

    return this.sendOtp(newPhone);
  }

  async verifyPhoneChangeOtp(userId: string, newPhone: string, code: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Re-check cooldown — prevents a race where the first request was within
    // the window but a second verify arrives after the window expired.
    this.checkPhoneChangeCooldown(user);

    // Guard again in case a concurrent request claimed the number between
    // request and verify steps.
    if (user.phone === newPhone) {
      throw new ConflictException({
        code: 'SAME_PHONE',
        message: 'New phone number is the same as the current one.',
      });
    }

    const taken = await this.userRepo.findOne({ where: { phone: newPhone } });
    if (taken) {
      throw new ConflictException({
        code: 'PHONE_TAKEN',
        message: 'This phone number is already in use.',
      });
    }

    const maxAttempts = this.configService.get<number>('OTP_MAX_ATTEMPTS', 3);

    const otpToken = await this.otpRepo
      .createQueryBuilder('otp')
      .where('otp.phone = :phone', { phone: newPhone })
      .andWhere('otp.expires_at > NOW()')
      .orderBy('otp.expires_at', 'DESC')
      .getOne();

    if (!otpToken) {
      throw new UnauthorizedException({
        code: 'OTP_EXPIRED',
        message: 'OTP expired or not requested',
      });
    }

    if (otpToken.attempts >= maxAttempts) {
      throw new HttpException(
        { code: 'TOO_MANY_ATTEMPTS', message: 'Too many OTP attempts, please request a new one' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const valid = await bcrypt.compare(code, otpToken.code_hash);
    if (!valid) {
      otpToken.attempts += 1;
      await this.otpRepo.save(otpToken);
      throw new UnauthorizedException({
        code: 'INVALID_OTP',
        message: 'Invalid OTP code',
      });
    }

    await this.otpRepo.delete({ id: otpToken.id });
    await this.userRepo.update(userId, { phone: newPhone, phone_changed_at: new Date() });

    return this.getMe(userId);
  }

  // ─── Driver application ───────────────────────────────────────────────────

  async applyAsDriver(userId: string, dto: ApplyAsDriverDto) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.role === UserRole.DRIVER) {
      const existing = await this.driverProfileRepo.findOne({
        where: { user_id: userId },
      });
      if (existing) {
        throw new ConflictException({
          code: 'ALREADY_APPLIED',
          message: 'Driver profile already exists',
        });
      }
    }

    const profile = await this.driverProfileRepo.save(
      this.driverProfileRepo.create({
        user_id: userId,
        vehicle_type: dto.vehicle_type,
        plate_number: dto.plate_number,
        capacity_kg: dto.capacity_kg,
      }),
    );

    await this.userRepo.update(userId, { role: UserRole.DRIVER });

    console.log(`[DRIVER_APPLICATION] New application from ${user.phone}`);
    return profile;
  }

  async getApplicationStatus(userId: string) {
    const profile = await this.driverProfileRepo.findOne({
      where: { user_id: userId },
    });
    if (!profile) throw new NotFoundException('Driver profile not found');
    return { status: profile.application_status };
  }

  // ─── OTP helpers (mirrored from AuthService for phone-change context) ─────

  private async checkHourlyCap(phone: string): Promise<void> {
    const key = `otp:rl:${phone}`;
    const now = Date.now();
    const cutoff = now - UsersService.HOUR_MS;

    const pipeline = this.redis.multi();
    pipeline.zremrangebyscore(key, 0, cutoff);
    pipeline.zcard(key);
    const results = await pipeline.exec();
    const count = (results?.[1]?.[1] as number) ?? 0;

    if (count >= UsersService.HOURLY_CAP) {
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'Too many OTP requests. Try again later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.redis
      .multi()
      .zadd(key, now, `${now}:${Math.random().toString(36).slice(2, 8)}`)
      .pexpire(key, UsersService.HOUR_MS)
      .exec();
  }

  private async sendOtp(phone: string): Promise<{ message: string; expiresIn: number }> {
    const otpTtl = this.configService.get<number>('OTP_TTL_SECONDS', 300);
    const cooldown = this.configService.get<number>('OTP_COOLDOWN_SECONDS', 60);

    const existing = await this.otpRepo
      .createQueryBuilder('otp')
      .where('otp.phone = :phone', { phone })
      .andWhere('otp.expires_at > NOW()')
      .orderBy('otp.expires_at', 'DESC')
      .getOne();

    if (existing) {
      const createdAt = new Date(existing.expires_at.getTime() - otpTtl * 1000);
      const cooldownEnds = new Date(createdAt.getTime() + cooldown * 1000);
      if (cooldownEnds > new Date()) {
        throw new ConflictException({
          code: 'OTP_COOLDOWN',
          message: 'OTP already requested, please wait before requesting again',
        });
      }
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = await bcrypt.hash(code, 10);

    await this.otpRepo.delete({ phone });

    const expiresAt = new Date(Date.now() + otpTtl * 1000);
    await this.otpRepo.save(
      this.otpRepo.create({ phone, code_hash: codeHash, expires_at: expiresAt }),
    );

    console.log(`[OTP:PHONE_CHANGE] ${phone}: ${code}`);
    return { message: 'OTP sent', expiresIn: otpTtl };
  }
}
