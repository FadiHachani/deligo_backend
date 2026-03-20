import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApplicationStatus } from '../common/enums';
import { User } from './user.entity';

@Entity('driver_profiles')
export class DriverProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  vehicle_type: string;

  @Column({ type: 'varchar' })
  plate_number: string;

  @Column({ type: 'int' })
  capacity_kg: number;

  @Column({
    type: 'enum',
    enum: ApplicationStatus,
    default: ApplicationStatus.PENDING,
  })
  application_status: ApplicationStatus;

  @Column({ type: 'boolean', default: false })
  is_online: boolean;

  @Column({ type: 'double precision', nullable: true })
  current_lat: number | null;

  @Column({ type: 'double precision', nullable: true })
  current_lng: number | null;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  current_h3_index: string | null;

  @Column({ type: 'float', default: 0 })
  avg_rating: number;

  @Column({ type: 'int', default: 0 })
  total_trips: number;

  @CreateDateColumn({ type: 'timestamptz' })
  applied_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  approved_at: Date | null;

  @OneToOne(() => User, (u) => u.driver_profile)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid', unique: true })
  user_id: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'approved_by' })
  approved_by_user: User | null;

  @Column({ type: 'uuid', nullable: true })
  approved_by: string | null;
}
