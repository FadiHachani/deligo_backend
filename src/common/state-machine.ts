import { BadRequestException } from '@nestjs/common';
import { RequestStatus, BookingStatus } from './enums';

const requestTransitions: Partial<Record<RequestStatus, RequestStatus[]>> = {
  [RequestStatus.OPEN]: [RequestStatus.BIDDING, RequestStatus.CANCELLED],
  [RequestStatus.BIDDING]: [RequestStatus.BOOKED, RequestStatus.CANCELLED],
  [RequestStatus.BOOKED]: [RequestStatus.IN_TRANSIT, RequestStatus.CANCELLED],
  [RequestStatus.IN_TRANSIT]: [RequestStatus.DELIVERED, RequestStatus.FAILED],
};

const bookingTransitions: Partial<Record<BookingStatus, BookingStatus[]>> = {
  [BookingStatus.CONFIRMED]: [BookingStatus.IN_TRANSIT],
  // IN_TRANSIT can still go directly to FAILED (driver flags an issue). For
  // the happy path, the driver uploads proof which moves us to
  // PENDING_CONFIRMATION; the client then confirms to reach DELIVERED.
  [BookingStatus.IN_TRANSIT]: [
    BookingStatus.PENDING_CONFIRMATION,
    BookingStatus.FAILED,
  ],
  [BookingStatus.PENDING_CONFIRMATION]: [BookingStatus.DELIVERED],
};

export function assertTransition(
  current: RequestStatus,
  target: RequestStatus,
): void;
export function assertTransition(
  current: BookingStatus,
  target: BookingStatus,
): void;
export function assertTransition(
  current: RequestStatus | BookingStatus,
  target: RequestStatus | BookingStatus,
): void {
  const requestAllowed = requestTransitions[current as RequestStatus];
  if (requestAllowed) {
    if (!requestAllowed.includes(target as RequestStatus)) {
      throw new BadRequestException({
        code: 'INVALID_STATUS_TRANSITION',
        message: `Cannot transition from ${current} to ${target}`,
      });
    }
    return;
  }

  const bookingAllowed = bookingTransitions[current as BookingStatus];
  if (bookingAllowed) {
    if (!bookingAllowed.includes(target as BookingStatus)) {
      throw new BadRequestException({
        code: 'INVALID_STATUS_TRANSITION',
        message: `Cannot transition from ${current} to ${target}`,
      });
    }
    return;
  }

  throw new BadRequestException({
    code: 'INVALID_STATUS_TRANSITION',
    message: `Cannot transition from ${current} to ${target}`,
  });
}
