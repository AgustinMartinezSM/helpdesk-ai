import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { INVITATION_STATUSES } from '../../domain/invitation';
import { GRANTABLE_ROLE_TEMPLATES } from '../../domain/role-grants';

export class CreateInvitationDto {
  @ApiProperty({ example: 'nueva.persona@empresa.com' })
  @IsEmail()
  @MaxLength(320)
  inviteeEmail!: string;

  /**
   * `owner` is absent from the list on purpose (see GRANTABLE_ROLE_TEMPLATES);
   * the use case refuses it again for callers that never went through HTTP.
   */
  @ApiProperty({ enum: GRANTABLE_ROLE_TEMPLATES })
  @IsIn(GRANTABLE_ROLE_TEMPLATES)
  roleTemplate!: string;
}

export class AcceptInvitationDto {
  /**
   * The whole code, `<invitationId>.<secret>`. It arrives in a BODY and never
   * in a path segment or query string: those end up in access logs, browser
   * history and Referer headers, and this one is a credential for exactly one
   * use.
   */
  @ApiProperty({ description: 'The invitation code, exactly as issued.' })
  @IsString()
  @MinLength(40)
  @MaxLength(200)
  code!: string;
}

export class ListInvitationsQueryDto {
  @ApiPropertyOptional({ enum: INVITATION_STATUSES })
  @IsOptional()
  @IsIn(INVITATION_STATUSES)
  status?: (typeof INVITATION_STATUSES)[number];

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
}
