import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { AnalyticsDomainError } from '../../domain/errors';

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/** Maps analytics domain errors to HTTP without leaking internals. */
@Catch(AnalyticsDomainError)
export class AnalyticsDomainErrorFilter implements ExceptionFilter {
  catch(exception: AnalyticsDomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();

    response.status(HttpStatus.FORBIDDEN).json({
      statusCode: HttpStatus.FORBIDDEN,
      error: 'Forbidden',
      message: exception.message,
    });
  }
}
