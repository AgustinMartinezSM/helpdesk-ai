import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  JwtAccessGuard,
  type AccessTokenPayload,
  type Actor,
} from '@helpdesk-ai/security';
import {
  ListMyNotificationsUseCase,
  MarkNotificationReadUseCase,
} from '../../application/use-cases/notification-queries';
import type { Notification } from '../../domain/notification';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { NotificationDomainErrorFilter } from './notification-domain-error.filter';

interface AuthenticatedRequest {
  user: AccessTokenPayload;
}

function actorOf(req: AuthenticatedRequest): Actor {
  return {
    id: req.user.sub,
    // The queries call requireOrganization on this: a token minted without
    // a tenant answers 403 via the filter, never an unscoped read. perms
    // stays along for the ride — no endpoint here gates on a permission.
    organizationId: req.user.org,
    permissions: new Set(req.user.perms ?? []),
  };
}

/** Wire shape: dates travel as ISO strings. */
interface NotificationResponse {
  id: string;
  type: string;
  ticketId: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

function toResponse(notification: Notification): NotificationResponse {
  return {
    id: notification.id,
    type: notification.type,
    ticketId: notification.ticketId,
    message: notification.message,
    readAt: notification.readAt ? notification.readAt.toISOString() : null,
    createdAt: notification.createdAt.toISOString(),
  };
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAccessGuard)
@UseFilters(NotificationDomainErrorFilter)
export class NotificationsController {
  constructor(
    private readonly listMine: ListMyNotificationsUseCase,
    private readonly markRead: MarkNotificationReadUseCase,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Own notifications, newest first' })
  async me(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationResponse[]> {
    const notifications = await this.listMine.execute(
      actorOf(req),
      query.limit,
    );
    return notifications.map(toResponse);
  }

  @Patch(':id/read')
  @ApiOperation({
    summary: 'Mark one of your notifications read (404 if not yours)',
  })
  async read(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationResponse> {
    return toResponse(await this.markRead.execute(actorOf(req), id));
  }
}
