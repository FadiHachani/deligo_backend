import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserRole } from '../common/enums';
import { DriverProfile } from './driver-profile.entity';
import { TransportRequest } from './transport-request.entity';
import { Notification } from './notification.entity';
import { RefreshToken } from './refresh-token.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  phone: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.CLIENT })
  role: UserRole;

  @Column({ type: 'varchar', nullable: true })
  full_name: string | null;

  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  @Column({ type: 'varchar', nullable: true })
  avatar_url: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'timestamptz', nullable: true, default: null })
  phone_changed_at: Date | null;

  // Aggregate ratings for any user (currently only clients are rated via this
  // field — drivers still use driver_profile.avg_rating which is preserved for
  // backwards compat). Maintained by RatingsService when a rating is saved.
  @Column({ type: 'float', default: 0 })
  avg_rating: number;

  @Column({ type: 'int', default: 0 })
  total_ratings: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @OneToOne(() => DriverProfile, (dp) => dp.user)
  driver_profile: DriverProfile;

  @OneToMany(() => TransportRequest, (req) => req.client)
  transport_requests: TransportRequest[];

  @OneToMany(() => Notification, (n) => n.user)
  notifications: Notification[];

  @OneToMany(() => RefreshToken, (rt) => rt.user)
  refresh_tokens: RefreshToken[];
}
