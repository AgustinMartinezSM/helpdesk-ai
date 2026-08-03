import { z } from '@helpdesk-ai/configuration';
import type {
  BranchSnapshot,
  SnapshotPage,
  StationSnapshot,
  StructureSnapshotSource,
  TeamSnapshot,
} from '../../application/ports/structure-snapshot.source';

/**
 * Reads the structure snapshot from organizations-service (Sprint 9.16).
 *
 * Same shape as the membership verifier next door and for the same reasons:
 * the shared service credential rather than a caller's bearer token (there is
 * no caller — this runs at boot), direct to the service rather than through
 * the api-gateway (ADR 0011), and the response is PARSED rather than trusted,
 * so a shape change upstream fails the reconciliation instead of writing
 * undefined into a projection that decides whether tickets can be filed.
 *
 * The timeout is longer than the verifier's five seconds: nobody is waiting on
 * this, and a page of two hundred rows against a cold database is allowed to
 * take a moment. It is still bounded — a hung read would otherwise hold the
 * walk open forever.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

const pageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });

const branchSchema = z.object({
  branchId: z.string().min(1),
  organizationId: z.string().min(1),
  code: z.string(),
  name: z.string(),
  status: z.string().min(1),
  updatedAt: z.string().min(1),
});

const stationSchema = z.object({
  stationId: z.string().min(1),
  branchId: z.string().min(1),
  organizationId: z.string().min(1),
  code: z.string(),
  name: z.string(),
  area: z.string().nullable(),
  status: z.string().min(1),
  updatedAt: z.string().min(1),
});

const teamSchema = z.object({
  teamId: z.string().min(1),
  organizationId: z.string().min(1),
  name: z.string(),
  status: z.string().min(1),
  branchIds: z.array(z.string().min(1)),
  updatedAt: z.string().min(1),
});

export class StructureSnapshotUnavailableError extends Error {
  constructor(reason: string) {
    super(`structure snapshot unavailable: ${reason}`);
    this.name = 'StructureSnapshotUnavailableError';
  }
}

export class HttpStructureSnapshotSource implements StructureSnapshotSource {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async branches(after: string | null): Promise<SnapshotPage<BranchSnapshot>> {
    const page = await this.read('branches', after, branchSchema);
    return {
      items: page.items.map((row) => ({
        ...row,
        updatedAt: new Date(row.updatedAt),
      })),
      nextCursor: page.nextCursor,
    };
  }

  async stations(after: string | null): Promise<SnapshotPage<StationSnapshot>> {
    const page = await this.read('stations', after, stationSchema);
    return {
      items: page.items.map((row) => ({
        ...row,
        updatedAt: new Date(row.updatedAt),
      })),
      nextCursor: page.nextCursor,
    };
  }

  async teams(after: string | null): Promise<SnapshotPage<TeamSnapshot>> {
    const page = await this.read('teams', after, teamSchema);
    return {
      items: page.items.map((row) => ({
        ...row,
        updatedAt: new Date(row.updatedAt),
      })),
      nextCursor: page.nextCursor,
    };
  }

  private async read<T extends z.ZodTypeAny>(
    resource: string,
    after: string | null,
    item: T,
  ): Promise<{ items: z.infer<T>[]; nextCursor: string | null }> {
    const query = after ? `?after=${encodeURIComponent(after)}` : '';
    const url = `${this.baseUrl}/internal/structure/${resource}${query}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          'x-internal-service-token': this.serviceToken,
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
        // undici strips `authorization` across a cross-origin redirect but not
        // a custom header, so a redirect is refused outright rather than
        // followed with the service credential attached (the rule Sprint 9.0
        // set for the AI provider fetch).
        redirect: 'error',
      });
    } catch (error) {
      throw new StructureSnapshotUnavailableError(
        error instanceof Error ? error.message : String(error),
      );
    }

    if (!response.ok) {
      throw new StructureSnapshotUnavailableError(
        `${resource} answered ${response.status}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new StructureSnapshotUnavailableError(
        `${resource} answered unreadable JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const parsed = pageSchema(item).safeParse(body);
    if (!parsed.success) {
      throw new StructureSnapshotUnavailableError(
        `${resource} answered an unexpected shape`,
      );
    }
    return parsed.data as { items: z.infer<T>[]; nextCursor: string | null };
  }
}
