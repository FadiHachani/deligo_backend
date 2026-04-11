import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { OtpToken } from '../../entities/otp-token.entity';
import { User } from '../../entities/user.entity';
import { RefreshToken } from '../../entities/refresh-token.entity';
import { DriverProfile } from '../../entities/driver-profile.entity';
import { UserRole } from '../../common/enums';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(OtpToken)
    private readonly otpRepo: Repository<OtpToken>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
    @InjectRepository(DriverProfile)
    private readonly driverProfileRepo: Repository<DriverProfile>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async requestRegisterOtp(
    phone: string,
  ): Promise<{ message: string; expiresIn: number }> {
    const existingUser = await this.userRepo.findOne({ where: { phone } });
    if (existingUser) {
      throw new ConflictException({
        code: 'PHONE_ALREADY_REGISTERED',
        message: 'This phone number is already linked to an account',
      });
    }

    return this.sendOtp(phone);
  }

  async requestLoginOtp(
    phone: string,
  ): Promise<{ message: string; expiresIn: number }> {
    const existingUser = await this.userRepo.findOne({ where: { phone } });
    if (!existingUser) {
      throw new NotFoundException({
        code: 'PHONE_NOT_FOUND',
        message: 'No account found with this phone number',
      });
    }

    return this.sendOtp(phone);
  }

  async verifyRegisterOtp(phone: string, code: string, full_name?: string, email?: string) {
    const existingUser = await this.userRepo.findOne({ where: { phone } });
    if (existingUser) {
      throw new ConflictException({
        code: 'PHONE_ALREADY_REGISTERED',
        message: 'This phone number is already linked to an account',
      });
    }

    return this.verifyOtpAndAuthenticate(phone, code, full_name, email);
  }

  async verifyLoginOtp(phone: string, code: string) {
    const existingUser = await this.userRepo.findOne({ where: { phone } });
    if (!existingUser) {
      throw new NotFoundException({
        code: 'PHONE_NOT_FOUND',
        message: 'No account found with this phone number',
      });
    }

    return this.verifyOtpAndAuthenticate(phone, code);
  }

  private async sendOtp(
    phone: string,
  ): Promise<{ message: string; expiresIn: number }> {
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
      this.otpRepo.create({
        phone,
        code_hash: codeHash,
        expires_at: expiresAt,
      }),
    );

    console.log(`[OTP] ${phone}: ${code}`);
    return { message: 'OTP sent', expiresIn: otpTtl };
  }

  private async verifyOtpAndAuthenticate(phone: string, code: string, full_name?: string, email?: string) {
    const maxAttempts = this.configService.get<number>('OTP_MAX_ATTEMPTS', 3);

    const otpToken = await this.otpRepo
      .createQueryBuilder('otp')
      .where('otp.phone = :phone', { phone })
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
        {
          code: 'TOO_MANY_ATTEMPTS',
          message: 'Too many OTP attempts, please request a new one',
        },
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

    let user = await this.userRepo.findOne({ where: { phone } });
    if (!user) {
      user = await this.userRepo.save(
        this.userRepo.create({
          phone,
          role: UserRole.CLIENT,
          full_name: full_name ?? null,
          email: email ?? null,
        }),
      );
    }

    const accessToken = this.generateAccessToken(user.id, user.role);
    const refreshToken = await this.generateRefreshToken(user.id);

    const userObj: Record<string, unknown> = {
      id: user.id,
      phone: user.phone,
      role: user.role,
      full_name: user.full_name,
      email: user.email,
    };

    if (user.role === UserRole.DRIVER) {
      const profile = await this.driverProfileRepo.findOne({
        where: { user_id: user.id },
      });
      if (profile) userObj['applicationStatus'] = profile.application_status;
    }

    return { accessToken, refreshToken, user: userObj };
  }

  async refresh(rawToken: string): Promise<{ accessToken: string }> {
    const hash = this.hashToken(rawToken);

    const tokenRecord = await this.refreshTokenRepo
      .createQueryBuilder('rt')
      .leftJoinAndSelect('rt.user', 'user')
      .where('rt.token_hash = :hash', { hash })
      .andWhere('rt.revoked = false')
      .andWhere('rt.expires_at > NOW()')
      .getOne();

    if (!tokenRecord) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or expired',
      });
    }

    const accessToken = this.generateAccessToken(
      tokenRecord.user.id,
      tokenRecord.user.role,
    );
    return { accessToken };
  }

  async logout(rawToken: string): Promise<{ message: string }> {
    const hash = this.hashToken(rawToken);
    await this.refreshTokenRepo.update({ token_hash: hash }, { revoked: true });
    return { message: 'Logged out' };
  }

  private generateAccessToken(userId: string, role: UserRole): string {
    const ttl = this.configService.get<string>(
      'JWT_ACCESS_TTL',
      '15m',
    ) as `${number}${'s' | 'm' | 'h' | 'd'}`;
    return this.jwtService.sign({ sub: userId, role }, { expiresIn: ttl });
  }

  private async generateRefreshToken(userId: string): Promise<string> {
    const rawToken = uuidv4();
    const hash = this.hashToken(rawToken);
    const days = this.configService.get<number>('JWT_REFRESH_TTL_DAYS', 30);
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    await this.refreshTokenRepo.save(
      this.refreshTokenRepo.create({
        user_id: userId,
        token_hash: hash,
        expires_at: expiresAt,
      }),
    );

    return rawToken;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
