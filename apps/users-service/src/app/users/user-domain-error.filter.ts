import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import {
  ForbiddenProfileActionError,
  UserDomainError,
} from '../../domain/errors';

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/** Maps user domain errors to HTTP without leaking domain internals. */
@Catch(UserDomainError)
export class UserDomainErrorFilter implements ExceptionFilter {
  catch(exception: UserDomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();

    let status = HttpStatus.NOT_FOUND;
    let error = 'Not Found';
    if (exception instanceof ForbiddenProfileActionError) {
      status = HttpStatus.FORBIDDEN;
      error = 'Forbidden';
    }

    response.status(status).json({
      statusCode: status,
      error,
      message: exception.message,
    });
  }
}
