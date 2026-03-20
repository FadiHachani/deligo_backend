import { IsUUID } from 'class-validator';

export class ListBidsDto {
  @IsUUID()
  request_id: string;
}
