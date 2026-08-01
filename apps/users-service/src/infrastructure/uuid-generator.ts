import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '../application/ports/user-profile.repository';

/**
 * Production IdGenerator: random UUIDs from node:crypto. A port so tests can
 * make identifiers deterministic (the organizations-service pattern).
 */
export class UuidGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
