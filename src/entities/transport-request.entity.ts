import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { RequestStatus } from '../common/enums';
import { User } from './user.entity';
import { Bid } from './bid.entity';

@Entity('transport_requests')
export class TransportRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'double precision' })
  pickup_lat: number;

  @Column({ type: 'double precision' })
  pickup_lng: number;

  @Column({ type: 'varchar', nullable: true })
  pickup_address: string | null;

  @Column({ type: 'varchar' })
  pickup_h3_index: string;

  @Column({ type: 'double precision' })
  dropoff_lat: number;

  @Column({ type: 'double precision' })
  dropoff_lng: number;

  @Column({ type: 'varchar', nullable: true })
  dropoff_address: string | null;

  @Column({ type: 'varchar' })
  dropoff_h3_index: string;

  @Column({ type: 'varchar' })
  item_category: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'json', default: [] })
  photo_urls: string[];

  @Index()
  @Column({ type: 'enum', enum: RequestStatus, default: RequestStatus.OPEN })
  status: RequestStatus;

  @Column({ type: 'timestamptz', nullable: true })
  scheduled_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => User, (u) => u.transport_requests)
  @JoinColumn({ name: 'client_id' })
  client: User;

  @Column({ type: 'uuid' })
  client_id: string;

  @OneToMany(() => Bid, (bid) => bid.request)
  bids: Bid[];
}
