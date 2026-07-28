import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

/**
 * Prisma 7 client wired to PostgreSQL through the pg driver adapter.
 *
 * Connection is deliberately lazy (no $connect on init): the process must
 * boot and answer liveness even when the database is down; readiness is the
 * endpoint that tells the truth by actually probing the connection.
 *
 * Provided through a factory (no decorator) because the constructor takes
 * the already-validated DATABASE_URL, not injectable dependencies.
 */
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(databaseUrl: string) {
    super({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
