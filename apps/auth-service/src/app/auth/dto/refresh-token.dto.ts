import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Body shape shared by refresh and logout. */
export class RefreshTokenDto {
  @ApiProperty({ description: 'Opaque refresh credential issued at login.' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  refreshToken!: string;
}

/**
 * Refresh, optionally saying where to land.
 *
 * A separate class from `RefreshTokenDto` because that one is shared with
 * logout, and `forbidNonWhitelisted` would otherwise make an organization id
 * sent to logout a 400 for no reason — or, worse, quietly accept it there.
 */
export class RefreshSessionDto extends RefreshTokenDto {
  /**
   * The organization the client remembers being in. A REQUEST: it is
   * validated against the caller's stored membership, and a request that
   * cannot be honoured falls back to the default rule rather than failing, so
   * somebody removed from an organization is not signed out by their own
   * client remembering it (ADR 0025).
   */
  @ApiPropertyOptional({
    description:
      'Organization to resume in. Validated at mint; ignored if unavailable.',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

/** The exchange body: where to go. Who is asking comes from the token. */
export class ExchangeOrganizationDto {
  @ApiProperty({ description: 'Organization to act in from now on.' })
  @IsUUID()
  organizationId!: string;
}
