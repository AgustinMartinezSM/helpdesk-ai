import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import {
  AuthDomainError,
  EmailAlreadyRegisteredError,
  TenantContextUnavailableError,
} from '../../domain/errors';

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/**
 * Maps domain errors to HTTP without letting controllers know status codes
 * or domain internals leak into responses. Every credential-shaped failure
 * maps to 401 with the error's client-safe message.
 *
 * The one failure here that is not about credentials is a tenant context that
 * could not be resolved. It answers 503, because the caller's password was
 * fine and a 401 would send them to reset one that works.
 */
@Catch(AuthDomainError)
export class AuthDomainErrorFilter implements ExceptionFilter {
  catch(exception: AuthDomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    const { status, error } = describe(exception);

    response.status(status).json({
      statusCode: status,
      error,
      message: exception.message,
    });
  }
}

function describe(exception: AuthDomainError): {
  status: number;
  error: string;
} {
  if (exception instanceof EmailAlreadyRegisteredError) {
    return { status: HttpStatus.CONFLICT, error: 'Conflict' };
  }
  if (exception instanceof TenantContextUnavailableError) {
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      error: 'Service Unavailable',
    };
  }
  return { status: HttpStatus.UNAUTHORIZED, error: 'Unauthorized' };
}
