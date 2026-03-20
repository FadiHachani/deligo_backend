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
  [BookingStatus.IN_TRANSIT]: [BookingStatus.DELIVERED, BookingStatus.FAILED],
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
