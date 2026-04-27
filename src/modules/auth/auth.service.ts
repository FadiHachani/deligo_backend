import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { OtpToken } from '../../entities/otp-token.entity';
import { User } from '../../entities/user.entity';
import { RefreshToken } from '../../entities/refresh-token.entity';
import { UserRole } from '../../common/enums';
import { REDIS_CLIENT } from '../../redis/redis.module';

@Injectable()
export class AuthService {
  // 20/hour gives breathing room in dev/QA while still bounding spam. Tighten
  // to 5 once SMS billing is live.
  private static readonly HOURLY_CAP = 20;
  private static readonly HOUR_MS = 60 * 60 * 1000;

  constructor(
    @InjectRepository(OtpToken)
    private readonly otpRepo: Repository<OtpToken>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // Sliding-window per-phone rate limit, backed by a Redis sorted set.
  // Score = unix-ms timestamp; member = same value (deduped per ms with a
  // suffix). On each call we prune entries older than 1h, count the rest,
  // reject if at the cap, then record the new timestamp. ZSET lets the
  // window slide smoothly (vs. fixed buckets) and the data survives restarts
  // and multi-instance deployments.
  //
  // We count on EVERY call (registered or not) so the no-enumeration response
  // shape stays identical regardless of phone-existence.
  private async checkHourlyCap(phone: string): Promise<void> {
    const key = `otp:rl:${phone}`;
    const now = Date.now();
    const cutoff = now - AuthService.HOUR_MS;

    const pipeline = this.redis.multi();
    pipeline.zremrangebyscore(key, 0, cutoff);
    pipeline.zcard(key);
    const results = await pipeline.exec();
    const count = (results?.[1]?.[1] as number) ?? 0;

    if (count >= AuthService.HOURLY_CAP) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Too many OTP requests. Try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Append a random suffix so the member is unique even if two requests
    // land in the same millisecond (ZSET dedupes by member, not score).
    await this.redis
      .multi()
      .zadd(key, now, `${now}:${Math.random().toString(36).slice(2, 8)}`)
      .pexpire(key, AuthService.HOUR_MS)
      .exec();
  }

  async requestRegisterOtp(
    phone: string,
  ): Promise<{ message: string; expiresIn: number }> {
    // Count BEFORE the existence check so the response is identical for
    // registered and unregistered phones (no account-enumeration leak).
    await this.checkHourlyCap(phone);

    const otpTtl = this.configService.get<number>('OTP_TTL_SECONDS', 300);
    const existingUser = await this.userRepo.findOne({ where: { phone } });
    if (existingUser) {
      // Phone is already registered. Don't issue an OTP, but return the same
      // shape an unregistered phone would get. The verify step will fail with
      // a generic "OTP expired" error — also non-leaking.
      return { message: 'OTP sent', expiresIn: otpTtl };
    }

    return this.sendOtp(phone);
  }

  async requestLoginOtp(
    phone: string,
  ): Promise<{ message: string; expiresIn: number }> {
    await this.checkHourlyCap(phone);

    const otpTtl = this.configService.get<number>('OTP_TTL_SECONDS', 300);
    const existingUser = await this.userRepo.findOne({ where: { phone } });
    if (!existingUser) {
      // No account for this phone. Don't issue an OTP, but return the same
      // success shape so an attacker can't probe the user table.
      return { message: 'OTP sent', expiresIn: otpTtl };
    }

    return this.sendOtp(phone);
  }

  async verifyRegisterOtp(phone: string, code: string, full_name?: string, email?: string) {
    const existingUser = await this.userRepo.findOne({ where: { phone } });
    if (existingUser) {
      // Already registered. Don't reveal that — fail with the generic
      // invalid-OTP error (no real OTP was issued for this phone in the
      // register flow, so verify can never succeed here anyway).
      throw new UnauthorizedException({
        code: 'INVALID_OTP',
        message: 'Invalid OTP code',
      });
    }

    return this.verifyOtpAndAuthenticate(phone, code, full_name, email);
  }

  async verifyLoginOtp(phone: string, code: string) {
    const existingUser = await this.userRepo.findOne({ where: { phone } });
    if (!existingUser) {
      // No account. Same generic error as a wrong code so an attacker can't
      // distinguish "phone not registered" from "wrong code".
      throw new UnauthorizedException({
        code: 'INVALID_OTP',
        message: 'Invalid OTP code',
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

    const fullUser = await this.userRepo.findOne({
      where: { id: user.id },
      relations: ['driver_profile'],
    });

    return { accessToken, refreshToken, user: fullUser };
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
