import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import {
  AuthDomainError,
  EmailAlreadyRegisteredError,
} from '../../domain/errors';

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/**
 * Maps domain errors to HTTP without letting controllers know status codes
 * or domain internals leak into responses. Every credential-shaped failure
 * maps to 401 with the error's client-safe message.
 */
@Catch(AuthDomainError)
export class AuthDomainErrorFilter implements ExceptionFilter {
  catch(exception: AuthDomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();

    const status =
      exception instanceof EmailAlreadyRegisteredError
        ? HttpStatus.CONFLICT
        : HttpStatus.UNAUTHORIZED;

    response.status(status).json({
      statusCode: status,
      error: status === HttpStatus.CONFLICT ? 'Conflict' : 'Unauthorized',
      message: exception.message,
    });
  }
}
