import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  SUPPORT_TEAM_STATUSES,
  type SupportTeamStatus,
} from '../../domain/support-team';

export class CreateSupportTeamDto {
  /** Immutable once set: other things refer to it. */
  @ApiProperty({ example: 'it' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;

  @ApiProperty({ example: 'IT support' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;
}

export class UpdateSupportTeamDto {
  // No `code`, like a branch's: it is the stable key.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ enum: SUPPORT_TEAM_STATUSES })
  @IsOptional()
  @IsIn(SUPPORT_TEAM_STATUSES)
  status?: SupportTeamStatus;
}

export class SetSupportTeamMembersDto {
  /**
   * The full desired set, BY USER ID — the identifier the People screen
   * shows, never the membership id this service keys on internally.
   */
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  userIds!: string[];
}

export class SetSupportTeamScopeDto {
  /**
   * The full desired branch set. AN EMPTY ARRAY IS MEANINGFUL: it makes the
   * team organization-wide, which is the difference between "serves
   * everywhere" and "serves nowhere" — the latter is not expressible, and
   * deliberately so.
   */
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  branchIds!: string[];
}
