import { UserRole } from '../enums';

export class JwtUser {
  sub: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}
