import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  BRANCH_STATUSES,
  DEPARTMENT_STATUSES,
  STATION_STATUSES,
  type BranchStatus,
  type DepartmentStatus,
  type StationStatus,
} from '../../domain/branch';

/**
 * On the PATCH DTOs, nullable columns (timezone, address, area,
 * responsibleUserId) accept an explicit null to CLEAR the value —
 * @IsOptional skips the remaining validators for null as well as undefined,
 * which is exactly the tri-state a PATCH needs: absent leaves the column
 * alone, null empties it, a value replaces it.
 *
 * The moved-from-internal shapes are unchanged except for one thing: a
 * station's responsible person is named by `responsibleUserId` now, never by
 * a membership id (Sprint 9.11, D3).
 */

export class CreateBranchDto {
  /** Immutable once set: other systems and people refer to it. */
  @ApiProperty({ example: 'store-12' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;

  @ApiProperty({ example: 'Store 12' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: 'America/Argentina/Buenos_Aires' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  address?: string;
}

export class UpdateBranchDto {
  // No `code`: renaming the stable key would orphan every reference to it
  // outside this database.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ enum: BRANCH_STATUSES })
  @IsOptional()
  @IsIn(BRANCH_STATUSES)
  status?: BranchStatus;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  timezone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  address?: string | null;
}

export class CreateDepartmentDto {
  @ApiProperty({ example: 'Electronics' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;
}

export class UpdateDepartmentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ enum: DEPARTMENT_STATUSES })
  @IsOptional()
  @IsIn(DEPARTMENT_STATUSES)
  status?: DepartmentStatus;
}

export class CreateStationDto {
  @ApiProperty({ example: 'cashier-2' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;

  @ApiProperty({ example: 'Cashier station 2' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  area?: string;

  /** WHO answers for the place, not who acts as it (ADR 0016/0017). */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  responsibleUserId?: string;
}

export class UpdateStationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ enum: STATION_STATUSES })
  @IsOptional()
  @IsIn(STATION_STATUSES)
  status?: StationStatus;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  area?: string | null;

  /** null clears it: a station may answer to nobody. */
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  responsibleUserId?: string | null;
}
