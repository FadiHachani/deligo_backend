import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Booking } from './booking.entity';
import { User } from './user.entity';

@Entity('ratings')
@Index(['booking_id', 'rated_by_id'], { unique: true })
@Check(`"score" >= 1 AND "score" <= 5`)
export class Rating {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int' })
  score: number;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => Booking)
  @JoinColumn({ name: 'booking_id' })
  booking: Booking;

  @Column({ type: 'uuid' })
  booking_id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'rated_by_id' })
  rated_by: User;

  @Column({ type: 'uuid' })
  rated_by_id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'rated_user_id' })
  rated_user: User;

  @Column({ type: 'uuid' })
  rated_user_id: string;
}
