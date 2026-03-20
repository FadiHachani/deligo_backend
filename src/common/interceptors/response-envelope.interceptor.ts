import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

function isPaginated(data: unknown): data is PaginatedData<unknown> {
  return (
    typeof data === 'object' &&
    data !== null &&
    'items' in data &&
    'total' in data &&
    'page' in data &&
    'limit' in data
  );
}

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        if (isPaginated(data)) {
          const { items, total, page, limit } = data;
          return {
            success: true,
            data: items,
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
          };
        }
        return { success: true, data };
      }),
    );
  }
}
