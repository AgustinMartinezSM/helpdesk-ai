import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import {
  BRANCH_STATUSES,
  DEPARTMENT_STATUSES,
  STATION_STATUSES,
  type BranchStatus,
  type DepartmentStatus,
  type StationStatus,
} from '../../domain/branch';

// The membership status and role DTOs moved to app/memberships/dto.ts in
// Sprint 9.10, with the operator endpoints that used them.

// ---------------------------------------------------------------------------
// Structure DTOs. On the PATCH DTOs, nullable columns (timezone, address,
// area, responsibleMembershipId) accept an explicit null to CLEAR the value
// — @IsOptional skips the remaining validators for null as well as
// undefined, which is exactly the tri-state PATCH needs: absent leaves the
// column alone, null empties it, a value replaces it.
// ---------------------------------------------------------------------------

export class CreateBranchDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  timezone?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  address?: string;
}

export class UpdateBranchDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  /** Vocabulary-checked here; there is no transition table for places. */
  @IsOptional()
  @IsIn(BRANCH_STATUSES)
  status?: BranchStatus;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  timezone?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  address?: string | null;
}

export class CreateDepartmentDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsIn(DEPARTMENT_STATUSES)
  status?: DepartmentStatus;
}

export class CreateStationDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  area?: string;

  @IsOptional()
  @IsUUID()
  responsibleMembershipId?: string;
}

export class UpdateStationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsIn(STATION_STATUSES)
  status?: StationStatus;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  area?: string | null;

  @IsOptional()
  @IsUUID()
  responsibleMembershipId?: string | null;
}
