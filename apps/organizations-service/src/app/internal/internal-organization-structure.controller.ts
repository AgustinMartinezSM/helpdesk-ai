import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type {
  Branch,
  Department,
  OperationalStation,
} from '../../domain/branch';
import { CreateBranchUseCase } from '../../application/use-cases/create-branch';
import { UpdateBranchUseCase } from '../../application/use-cases/update-branch';
import { CreateDepartmentUseCase } from '../../application/use-cases/create-department';
import { UpdateDepartmentUseCase } from '../../application/use-cases/update-department';
import { CreateStationUseCase } from '../../application/use-cases/create-station';
import { UpdateStationUseCase } from '../../application/use-cases/update-station';
import {
  CreateBranchDto,
  CreateDepartmentDto,
  CreateStationDto,
  UpdateBranchDto,
  UpdateDepartmentDto,
  UpdateStationDto,
} from './dto';
import { InternalServiceGuard } from './internal-service.guard';
import { OrganizationDomainErrorFilter } from './organization-domain-error.filter';

interface BranchResponse {
  branchId: string;
  organizationId: string;
  code: string;
  name: string;
  status: string;
  timezone: string | null;
  address: string | null;
}

interface DepartmentResponse {
  departmentId: string;
  branchId: string;
  name: string;
  status: string;
}

interface StationResponse {
  stationId: string;
  branchId: string;
  code: string;
  name: string;
  area: string | null;
  responsibleMembershipId: string | null;
  status: string;
}

/**
 * The operator surface for organizational structure (Sprint 9.5, D1) —
 * internal and service-token-guarded like the membership lifecycle PATCH,
 * and for the same reason: the real admin surface arrives with the
 * people-management sprint, but branches and stations have to exist before
 * the retail scenario can be exercised at all.
 *
 * Same 404/409 semantics as the status PATCH: an unknown id and a foreign
 * one answer the same 404 (confirming existence is the leak), and a
 * duplicate code answers 409 because the state, not the request shape,
 * refused the operation.
 */
@ApiExcludeController()
@Controller('internal/organizations/:organizationId')
@UseGuards(InternalServiceGuard)
@UseFilters(OrganizationDomainErrorFilter)
export class InternalOrganizationStructureController {
  constructor(
    private readonly createBranch: CreateBranchUseCase,
    private readonly updateBranch: UpdateBranchUseCase,
    private readonly createDepartment: CreateDepartmentUseCase,
    private readonly updateDepartment: UpdateDepartmentUseCase,
    private readonly createStation: CreateStationUseCase,
    private readonly updateStation: UpdateStationUseCase,
  ) {}

  @Post('branches')
  async postBranch(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Body() dto: CreateBranchDto,
  ): Promise<BranchResponse> {
    const branch = await this.createBranch.execute({
      organizationId,
      code: dto.code,
      name: dto.name,
      timezone: dto.timezone,
      address: dto.address,
    });
    return toBranchResponse(branch);
  }

  @Patch('branches/:branchId')
  async patchBranch(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() dto: UpdateBranchDto,
  ): Promise<BranchResponse> {
    const branch = await this.updateBranch.execute({
      organizationId,
      branchId,
      name: dto.name,
      status: dto.status,
      timezone: dto.timezone,
      address: dto.address,
    });
    return toBranchResponse(branch);
  }

  @Post('branches/:branchId/departments')
  async postDepartment(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() dto: CreateDepartmentDto,
  ): Promise<DepartmentResponse> {
    const department = await this.createDepartment.execute({
      organizationId,
      branchId,
      name: dto.name,
    });
    return toDepartmentResponse(department);
  }

  @Patch('departments/:departmentId')
  async patchDepartment(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('departmentId', new ParseUUIDPipe()) departmentId: string,
    @Body() dto: UpdateDepartmentDto,
  ): Promise<DepartmentResponse> {
    const department = await this.updateDepartment.execute({
      organizationId,
      departmentId,
      name: dto.name,
      status: dto.status,
    });
    return toDepartmentResponse(department);
  }

  @Post('branches/:branchId/stations')
  async postStation(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() dto: CreateStationDto,
  ): Promise<StationResponse> {
    const station = await this.createStation.execute({
      organizationId,
      branchId,
      code: dto.code,
      name: dto.name,
      area: dto.area,
      responsibleMembershipId: dto.responsibleMembershipId,
    });
    return toStationResponse(station);
  }

  @Patch('stations/:stationId')
  async patchStation(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('stationId', new ParseUUIDPipe()) stationId: string,
    @Body() dto: UpdateStationDto,
  ): Promise<StationResponse> {
    const station = await this.updateStation.execute({
      organizationId,
      stationId,
      name: dto.name,
      status: dto.status,
      area: dto.area,
      responsibleMembershipId: dto.responsibleMembershipId,
    });
    return toStationResponse(station);
  }
}

function toBranchResponse(branch: Branch): BranchResponse {
  return {
    branchId: branch.id,
    organizationId: branch.organizationId,
    code: branch.code,
    name: branch.name,
    status: branch.status,
    timezone: branch.timezone,
    address: branch.address,
  };
}

function toDepartmentResponse(department: Department): DepartmentResponse {
  return {
    departmentId: department.id,
    branchId: department.branchId,
    name: department.name,
    status: department.status,
  };
}

function toStationResponse(station: OperationalStation): StationResponse {
  return {
    stationId: station.id,
    branchId: station.branchId,
    code: station.code,
    name: station.name,
    area: station.area,
    responsibleMembershipId: station.responsibleMembershipId,
    status: station.status,
  };
}
