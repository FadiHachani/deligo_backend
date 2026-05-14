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
  // RequestStatus and BookingStatus share string values (e.g. "IN_TRANSIT"),
  // so we can't pick the right table from `current` alone. The target is
  // unambiguous: PENDING_CONFIRMATION/CONFIRMED only exist on BookingStatus,
  // and OPEN/BIDDING/BOOKED only on RequestStatus. Use the target to pick
  // the table; otherwise fall back to whichever table contains `current`.
  const isBookingTarget = (Object.values(BookingStatus) as string[]).includes(
    target as string,
  );
  const isRequestTarget = (Object.values(RequestStatus) as string[]).includes(
    target as string,
  );

  let allowed: readonly string[] | undefined;
  if (isBookingTarget && !isRequestTarget) {
    allowed = bookingTransitions[current as BookingStatus];
  } else if (isRequestTarget && !isBookingTarget) {
    allowed = requestTransitions[current as RequestStatus];
  } else {
    // Target string lives in both enums — disambiguate by `current`.
    allowed =
      requestTransitions[current as RequestStatus] ??
      bookingTransitions[current as BookingStatus];
  }

  if (!allowed || !allowed.includes(target as string)) {
    throw new BadRequestException({
      code: 'INVALID_STATUS_TRANSITION',
      message: `Cannot transition from ${current} to ${target}`,
    });
  }
}
