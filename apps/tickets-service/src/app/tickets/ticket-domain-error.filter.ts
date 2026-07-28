import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import {
  ForbiddenTicketActionError,
  InvalidStatusTransitionError,
  TicketDomainError,
} from '../../domain/errors';

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/** Maps ticket domain errors to HTTP without leaking domain internals. */
@Catch(TicketDomainError)
export class TicketDomainErrorFilter implements ExceptionFilter {
  catch(exception: TicketDomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();

    let status = HttpStatus.NOT_FOUND;
    let error = 'Not Found';
    if (exception instanceof ForbiddenTicketActionError) {
      status = HttpStatus.FORBIDDEN;
      error = 'Forbidden';
    } else if (exception instanceof InvalidStatusTransitionError) {
      status = HttpStatus.CONFLICT;
      error = 'Conflict';
    }

    response.status(status).json({
      statusCode: status,
      error,
      message: exception.message,
    });
  }
}
