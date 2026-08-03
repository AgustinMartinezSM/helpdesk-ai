import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { MAX_IMPORT_CHARACTERS } from '../../domain/people-import';

export class ImportPeopleDto {
  /**
   * The file's text, not a multipart upload (Sprint 9.15, D3).
   *
   * The length cap is repeated from the domain constant rather than restated,
   * so the DTO and the parser cannot disagree about what is too big — the
   * parser refuses the same size with a reason the caller can render, and this
   * one keeps a payload that could not possibly be a valid file from being
   * parsed at all.
   */
  @ApiProperty({ maxLength: MAX_IMPORT_CHARACTERS })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_IMPORT_CHARACTERS)
  csv!: string;
}
