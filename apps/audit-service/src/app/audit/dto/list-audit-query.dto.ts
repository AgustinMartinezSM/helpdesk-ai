import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export class ListAuditQueryDto {
  /** Exact event type; the pattern keeps free-form strings out of the WHERE. */
  @IsOptional()
  @Matches(/^[a-z][a-z-]*(\.[a-z][a-z-]*)*\.v\d+$/, {
    message:
      'type must look like a versioned event name, e.g. ticket.created.v1',
  })
  type?: string;

  /** Bounded on purpose: the trail must not be exfiltrable in one request. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
}
