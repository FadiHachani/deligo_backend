import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BookingStatus } from '../common/enums';
import { TransportRequest } from './transport-request.entity';
import { Bid } from './bid.entity';
import { User } from './user.entity';

@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: BookingStatus,
    default: BookingStatus.CONFIRMED,
  })
  status: BookingStatus;

  @Column({ type: 'timestamptz', nullable: true })
  started_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  delivered_at: Date | null;

  @ManyToOne(() => TransportRequest)
  @JoinColumn({ name: 'request_id' })
  request: TransportRequest;

  @Column({ type: 'uuid' })
  request_id: string;

  @ManyToOne(() => Bid)
  @JoinColumn({ name: 'bid_id' })
  bid: Bid;

  @Column({ type: 'uuid' })
  bid_id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'driver_id' })
  driver: User;

  @Column({ type: 'uuid' })
  driver_id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'client_id' })
  client: User;

  @Column({ type: 'uuid' })
  client_id: string;
}
