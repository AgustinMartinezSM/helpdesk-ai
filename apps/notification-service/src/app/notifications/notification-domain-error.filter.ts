import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { NotificationDomainError } from '../../domain/errors';

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/** Maps notification domain errors to HTTP without leaking internals. */
@Catch(NotificationDomainError)
export class NotificationDomainErrorFilter implements ExceptionFilter {
  catch(exception: NotificationDomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();

    response.status(HttpStatus.NOT_FOUND).json({
      statusCode: HttpStatus.NOT_FOUND,
      error: 'Not Found',
      message: exception.message,
    });
  }
}
