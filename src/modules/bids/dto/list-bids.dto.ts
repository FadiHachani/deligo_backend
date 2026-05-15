import { IsOptional, IsUUID } from 'class-validator';

export class ListBidsDto {
  // Optional. When omitted by a driver, returns the driver's own active bids
  // across every request. Required for client callers (a client only ever
  // lists bids in the context of one of their requests).
  @IsOptional()
  @IsUUID()
  request_id?: string;
}
