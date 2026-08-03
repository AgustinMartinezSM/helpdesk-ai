import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketPriority,
  type TicketStatus,
} from '../../domain/ticket';

export class CreateTicketDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ maxLength: 5000 })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  description!: string;

  @ApiPropertyOptional({ enum: TICKET_PRIORITIES })
  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: TicketPriority;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  /**
   * The assignee idiom, relaxed one notch: the field is optional AND
   * nullable, and @IsOptional already skips null as well as undefined, so
   * the explicit @ValidateIf the required assigneeId needs is not needed
   * here — @IsUUID only ever sees a real value.
   */
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Branch this request is filed under; omit or null for none.',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Station within the branch; only valid alongside branchId.',
  })
  @IsOptional()
  @IsUUID()
  stationId?: string | null;
}

export class ChangeStatusDto {
  @ApiProperty({ enum: TICKET_STATUSES })
  @IsIn(TICKET_STATUSES)
  status!: TicketStatus;
}

export class AssignTicketDto {
  @ApiProperty({ nullable: true, description: 'null clears the assignment' })
  @ValidateIf((dto: AssignTicketDto) => dto.assigneeId !== null)
  @IsUUID()
  assigneeId!: string | null;
}

export class AddCommentDto {
  @ApiProperty({ maxLength: 5000 })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;

  @ApiPropertyOptional({ description: 'Staff only; hidden from requesters.' })
  @IsOptional()
  @IsBoolean()
  internal?: boolean;
}

export class ListTicketsQueryDto {
  @ApiPropertyOptional({ enum: TICKET_STATUSES })
  @IsOptional()
  @IsIn(TICKET_STATUSES)
  status?: TicketStatus;

  @ApiPropertyOptional({ description: 'Staff only filter.' })
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional({
    description:
      'Narrow to one branch. Organization-wide for read_all; intersected ' +
      "with the caller's branch set for read_branch.",
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  take?: number;
}

/**
 * Routing a ticket to the SUPPORT TEAM that should resolve it. Null clears
 * it, and the ticket returns to the central view.
 */
export class RouteTicketDto {
  @ApiProperty({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  teamId!: string | null;
}
