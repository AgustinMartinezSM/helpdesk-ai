/**
 * Browser-side client for organization setup — branches and what is inside
 * them, all from organizations-service through the one /organization prefix.
 *
 * Refusals arrive with their status intact and must not be rewritten: a 404
 * on a branch means BOTH "no such branch" and "not yours", which is the
 * server's existence-hiding design rather than an oversight, and a 403 means
 * the permission is missing — possibly only for the next few minutes, since
 * the session's permission list is a snapshot (ADR 0020).
 */
import { PeopleApiError } from './people';

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? 'http://localhost:3001';

export type StructureStatus = 'active' | 'archived';

export interface Branch {
  branchId: string;
  /** Stable operator-facing key, unique per organization, immutable. */
  code: string;
  name: string;
  status: StructureStatus;
  timezone: string | null;
  address: string | null;
}

export interface Department {
  departmentId: string;
  branchId: string;
  name: string;
  status: StructureStatus;
}

export interface Station {
  stationId: string;
  branchId: string;
  code: string;
  name: string;
  area: string | null;
  /** The person who answers for the place, never one who acts as it. */
  responsibleUserId: string | null;
  status: StructureStatus;
}

export interface BranchStructure {
  departments: Department[];
  stations: Station[];
}

async function call<T>(
  accessToken: string,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${BFF_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let message = 'Something went wrong';
    try {
      const parsed = (await response.json()) as { message?: string | string[] };
      message = Array.isArray(parsed.message)
        ? parsed.message.join(', ')
        : (parsed.message ?? message);
    } catch {
      // keep the generic message
    }
    throw new PeopleApiError(message, response.status);
  }

  return (await response.json()) as T;
}

export function listBranches(accessToken: string): Promise<Branch[]> {
  return call(accessToken, 'GET', '/organization/branches');
}

export function createBranch(
  accessToken: string,
  input: { code: string; name: string; timezone?: string; address?: string },
): Promise<Branch> {
  return call(accessToken, 'POST', '/organization/branches', input);
}

/** The code is absent on purpose: it is immutable once registered. */
export function updateBranch(
  accessToken: string,
  branchId: string,
  changes: {
    name?: string;
    status?: StructureStatus;
    timezone?: string | null;
    address?: string | null;
  },
): Promise<Branch> {
  return call(
    accessToken,
    'PATCH',
    `/organization/branches/${encodeURIComponent(branchId)}`,
    changes,
  );
}

export function getBranchStructure(
  accessToken: string,
  branchId: string,
): Promise<BranchStructure> {
  return call(
    accessToken,
    'GET',
    `/organization/branches/${encodeURIComponent(branchId)}/structure`,
  );
}

export function createDepartment(
  accessToken: string,
  branchId: string,
  name: string,
): Promise<Department> {
  return call(
    accessToken,
    'POST',
    `/organization/branches/${encodeURIComponent(branchId)}/departments`,
    { name },
  );
}

export function updateDepartment(
  accessToken: string,
  departmentId: string,
  changes: { name?: string; status?: StructureStatus },
): Promise<Department> {
  return call(
    accessToken,
    'PATCH',
    `/organization/departments/${encodeURIComponent(departmentId)}`,
    changes,
  );
}

export function createStation(
  accessToken: string,
  branchId: string,
  input: {
    code: string;
    name: string;
    area?: string;
    responsibleUserId?: string;
  },
): Promise<Station> {
  return call(
    accessToken,
    'POST',
    `/organization/branches/${encodeURIComponent(branchId)}/stations`,
    input,
  );
}

export function updateStation(
  accessToken: string,
  stationId: string,
  changes: {
    name?: string;
    status?: StructureStatus;
    area?: string | null;
    responsibleUserId?: string | null;
  },
): Promise<Station> {
  return call(
    accessToken,
    'PATCH',
    `/organization/stations/${encodeURIComponent(stationId)}`,
    changes,
  );
}

/**
 * The product's word for a place. ADR 0016 is explicit that the interface
 * should say "cashier station 2", not "operational station" — the model's
 * vocabulary and the product's are allowed to differ.
 */
export const STATION_LABEL = 'Service point';
