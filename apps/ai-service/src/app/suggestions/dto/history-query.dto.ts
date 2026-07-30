import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class HistoryQueryDto {
  /** Bounded: a ticket regenerated many times must not turn one request
   * into a large response. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 20;
}
