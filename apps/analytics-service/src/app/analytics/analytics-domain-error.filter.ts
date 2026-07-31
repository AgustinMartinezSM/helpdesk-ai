import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { NoOrganizationContextError } from '@helpdesk-ai/security';
import { AnalyticsDomainError } from '../../domain/errors';

interface JsonResponse {
  status(code: number): { json(body: unknown): void };
}

/**
 * Maps analytics domain errors to HTTP without leaking internals.
 *
 * NoOrganizationContextError lives in @helpdesk-ai/security (it is the
 * shared requireOrganization helper that throws it), so it is caught by
 * name next to the domain hierarchy rather than through it. 403 like the
 * permission refusal: authenticated, but entitled to no organization's
 * dashboard yet — and the caller should be told why.
 */
@Catch(AnalyticsDomainError, NoOrganizationContextError)
export class AnalyticsDomainErrorFilter implements ExceptionFilter {
  catch(
    exception: AnalyticsDomainError | NoOrganizationContextError,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();

    response.status(HttpStatus.FORBIDDEN).json({
      statusCode: HttpStatus.FORBIDDEN,
      error: 'Forbidden',
      message: exception.message,
    });
  }
}
