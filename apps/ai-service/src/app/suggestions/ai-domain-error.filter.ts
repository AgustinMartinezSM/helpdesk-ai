import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import {
  AiDomainError,
  ForbiddenAiActionError,
  ProviderOutputError,
  ProviderUnavailableError,
  TicketAccessUnauthorizedError,
  TicketNotFoundError,
  TicketSourceUnavailableError,
} from '../../domain/errors';

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/**
 * Maps AI domain errors to HTTP.
 *
 * The distinctions are the point: a caller needs to know whether to fix
 * their request (403/404), refresh their session (401), retry later (503)
 * or report a defect (502). Collapsing them into 500 would make every
 * failure look like the same outage.
 */
@Catch(AiDomainError)
export class AiDomainErrorFilter implements ExceptionFilter {
  catch(exception: AiDomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    const { status, error } = classify(exception);

    response.status(status).json({
      statusCode: status,
      error,
      message: exception.message,
    });
  }
}

function classify(exception: AiDomainError): { status: number; error: string } {
  if (exception instanceof ForbiddenAiActionError) {
    return { status: HttpStatus.FORBIDDEN, error: 'Forbidden' };
  }
  if (exception instanceof TicketNotFoundError) {
    return { status: HttpStatus.NOT_FOUND, error: 'Not Found' };
  }
  if (exception instanceof TicketAccessUnauthorizedError) {
    return { status: HttpStatus.UNAUTHORIZED, error: 'Unauthorized' };
  }
  if (
    exception instanceof TicketSourceUnavailableError ||
    exception instanceof ProviderUnavailableError
  ) {
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      error: 'Service Unavailable',
    };
  }
  if (exception instanceof ProviderOutputError) {
    // The provider answered; what it said was unusable. That is upstream of
    // us and not a transient condition, so it is not a 503.
    return { status: HttpStatus.BAD_GATEWAY, error: 'Bad Gateway' };
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    error: 'Internal Server Error',
  };
}
