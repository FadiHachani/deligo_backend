export enum UserRole {
  CLIENT = 'CLIENT',
  DRIVER = 'DRIVER',
  ADMIN = 'ADMIN',
}

export enum ApplicationStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum RequestStatus {
  OPEN = 'OPEN',
  BIDDING = 'BIDDING',
  BOOKED = 'BOOKED',
  IN_TRANSIT = 'IN_TRANSIT',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

export enum BidStatus {
  PENDING = 'PENDING',
  COUNTERED_BY_CLIENT = 'COUNTERED_BY_CLIENT',
  COUNTERED_BY_DRIVER = 'COUNTERED_BY_DRIVER',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  WITHDRAWN = 'WITHDRAWN',
}

export enum BookingStatus {
  CONFIRMED = 'CONFIRMED',
  IN_TRANSIT = 'IN_TRANSIT',
  // Driver has uploaded proof-of-delivery photo. Waiting on the client to
  // upload their own confirmation photo (or for the 24h auto-confirm).
  PENDING_CONFIRMATION = 'PENDING_CONFIRMATION',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
}
