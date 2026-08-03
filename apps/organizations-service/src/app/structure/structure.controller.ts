import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  JwtAccessGuard,
  type AccessTokenPayload,
  type Actor,
} from '@helpdesk-ai/security';
import type {
  Branch,
  Department,
  OperationalStation,
} from '../../domain/branch';
import { CreateBranchUseCase } from '../../application/use-cases/create-branch';
import { CreateDepartmentUseCase } from '../../application/use-cases/create-department';
import { CreateStationUseCase } from '../../application/use-cases/create-station';
import {
  ListBranchStructureUseCase,
  type StationView,
} from '../../application/use-cases/list-branch-structure';
import { ListBranchesUseCase } from '../../application/use-cases/membership-branches';
import { UpdateBranchUseCase } from '../../application/use-cases/update-branch';
import { UpdateDepartmentUseCase } from '../../application/use-cases/update-department';
import { UpdateStationUseCase } from '../../application/use-cases/update-station';
import { OrganizationDomainErrorFilter } from '../organization-domain-error.filter';
import {
  CreateBranchDto,
  CreateDepartmentDto,
  CreateStationDto,
  UpdateBranchDto,
  UpdateDepartmentDto,
  UpdateStationDto,
} from './dto';

interface AuthenticatedRequest {
  user: AccessTokenPayload;
}

function actorOf(req: AuthenticatedRequest): Actor {
  return {
    id: req.user.sub,
    organizationId: req.user.org,
    permissions: new Set(req.user.perms ?? []),
  };
}

interface BranchResponse {
  branchId: string;
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
  /** The person who answers for the place, by the id People also shows. */
  responsibleUserId: string | null;
  status: string;
}

interface BranchStructureResponse {
  departments: DepartmentResponse[];
  stations: StationResponse[];
}

/**
 * Organization setup: branches and what is inside them (Sprint 9.11).
 *
 * This replaces `InternalOrganizationStructureController`, which did the same
 * work behind `INTERNAL_SERVICE_TOKEN` with the tenant as a path parameter.
 * Both halves of that mattered: the credential made every branch nobody's
 * doing (ADR 0016), and the path parameter made "which organization" a thing
 * the caller said rather than a thing the platform knew. Here the tenant
 * comes from the token and appears in no route.
 *
 * `organizations/branches` already existed as a read for the People screen's
 * branch editor (Sprint 9.10); the listing below is that same route, and the
 * writes joined it rather than starting a second prefix for the same nouns.
 */
@ApiTags('structure')
@ApiBearerAuth()
@Controller('organizations/branches')
@UseGuards(JwtAccessGuard)
@UseFilters(OrganizationDomainErrorFilter)
export class OrganizationStructureController {
  constructor(
    private readonly listBranches: ListBranchesUseCase,
    private readonly listBranchStructure: ListBranchStructureUseCase,
    private readonly createBranch: CreateBranchUseCase,
    private readonly updateBranch: UpdateBranchUseCase,
    private readonly createDepartment: CreateDepartmentUseCase,
    private readonly createStation: CreateStationUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Branches of the caller organization, archived ones included.',
  })
  async list(@Req() req: AuthenticatedRequest): Promise<BranchResponse[]> {
    const branches = await this.listBranches.execute(actorOf(req));
    return branches.map(toBranchResponse);
  }

  @Post()
  @ApiOperation({ summary: 'Register a branch (branches.create).' })
  async postBranch(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateBranchDto,
  ): Promise<BranchResponse> {
    return toBranchResponse(
      await this.createBranch.execute(actorOf(req), {
        code: dto.code,
        name: dto.name,
        timezone: dto.timezone,
        address: dto.address,
      }),
    );
  }

  @Patch(':branchId')
  @ApiOperation({
    summary: 'Rename, re-zone or archive a branch (branches.update).',
  })
  async patchBranch(
    @Req() req: AuthenticatedRequest,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() dto: UpdateBranchDto,
  ): Promise<BranchResponse> {
    return toBranchResponse(
      await this.updateBranch.execute(actorOf(req), {
        branchId,
        name: dto.name,
        status: dto.status,
        timezone: dto.timezone,
        address: dto.address,
      }),
    );
  }

  @Get(':branchId/structure')
  @ApiOperation({
    summary: "One branch's departments and stations (branches.read).",
  })
  async structure(
    @Req() req: AuthenticatedRequest,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
  ): Promise<BranchStructureResponse> {
    const structure = await this.listBranchStructure.execute(
      actorOf(req),
      branchId,
    );
    return {
      departments: structure.departments.map(toDepartmentResponse),
      stations: structure.stations.map(toStationResponse),
    };
  }

  @Post(':branchId/departments')
  async postDepartment(
    @Req() req: AuthenticatedRequest,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() dto: CreateDepartmentDto,
  ): Promise<DepartmentResponse> {
    return toDepartmentResponse(
      await this.createDepartment.execute(actorOf(req), {
        branchId,
        name: dto.name,
      }),
    );
  }

  @Post(':branchId/stations')
  async postStation(
    @Req() req: AuthenticatedRequest,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
    @Body() dto: CreateStationDto,
  ): Promise<StationResponse> {
    const station = await this.createStation.execute(actorOf(req), {
      branchId,
      code: dto.code,
      name: dto.name,
      area: dto.area,
      responsibleUserId: dto.responsibleUserId,
    });
    return toStationResponse({
      station,
      responsibleUserId: dto.responsibleUserId ?? null,
    });
  }
}

/**
 * Departments and stations are edited by their own id, so their PATCH routes
 * cannot hang off `branches/:branchId` without asking the caller to repeat a
 * parent the row already knows. A second controller keeps both paths honest
 * rather than inventing a redundant segment.
 */
@ApiTags('structure')
@ApiBearerAuth()
@Controller('organizations')
@UseGuards(JwtAccessGuard)
@UseFilters(OrganizationDomainErrorFilter)
export class OrganizationStructureItemsController {
  constructor(
    private readonly updateDepartment: UpdateDepartmentUseCase,
    private readonly updateStation: UpdateStationUseCase,
  ) {}

  @Patch('departments/:departmentId')
  @ApiOperation({ summary: 'Rename or archive a department.' })
  async patchDepartment(
    @Req() req: AuthenticatedRequest,
    @Param('departmentId', new ParseUUIDPipe()) departmentId: string,
    @Body() dto: UpdateDepartmentDto,
  ): Promise<DepartmentResponse> {
    return toDepartmentResponse(
      await this.updateDepartment.execute(actorOf(req), {
        departmentId,
        name: dto.name,
        status: dto.status,
      }),
    );
  }

  @Patch('stations/:stationId')
  @ApiOperation({
    summary: 'Rename, re-area, archive or re-assign a station.',
  })
  async patchStation(
    @Req() req: AuthenticatedRequest,
    @Param('stationId', new ParseUUIDPipe()) stationId: string,
    @Body() dto: UpdateStationDto,
  ): Promise<StationResponse> {
    const station = await this.updateStation.execute(actorOf(req), {
      stationId,
      name: dto.name,
      status: dto.status,
      area: dto.area,
      responsibleUserId: dto.responsibleUserId,
    });
    return toStationResponse({
      station,
      // Echoed from the request: the row holds a membership id, and the one
      // place that translates it back is the listing.
      responsibleUserId: dto.responsibleUserId ?? null,
    });
  }
}

function toBranchResponse(branch: Branch): BranchResponse {
  return {
    branchId: branch.id,
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

function toStationResponse(view: StationView): StationResponse {
  const station: OperationalStation = view.station;
  return {
    stationId: station.id,
    branchId: station.branchId,
    code: station.code,
    name: station.name,
    area: station.area,
    responsibleUserId: view.responsibleUserId,
    status: station.status,
  };
}
