import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BidStatus } from '../common/enums';
import { TransportRequest } from './transport-request.entity';
import { User } from './user.entity';

@Entity('bids')
@Index(['request_id', 'driver_id'], { unique: true })
export class Bid {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'decimal', precision: 10, scale: 3 })
  price_tnd: number;

  @Column({ type: 'int' })
  eta_minutes: number;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ type: 'enum', enum: BidStatus, default: BidStatus.PENDING })
  status: BidStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => TransportRequest, (req) => req.bids)
  @JoinColumn({ name: 'request_id' })
  request: TransportRequest;

  @Column({ type: 'uuid' })
  request_id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'driver_id' })
  driver: User;

  @Column({ type: 'uuid' })
  driver_id: string;
}
