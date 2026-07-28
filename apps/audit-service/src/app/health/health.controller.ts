import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { APP_ENV, SERVICE_NAME, type AuditServiceEnv } from '../../config/env';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

interface LivenessReport {
  status: 'ok';
  service: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
}

interface DependencyCheck {
  name: string;
  status: 'up' | 'down';
}

interface ReadinessReport extends LivenessReport {
  checks: DependencyCheck[];
}

@Controller('health')
export class HealthController {
  constructor(
    @Inject(APP_ENV) private readonly env: AuditServiceEnv,
    private readonly prisma: PrismaService,
  ) {}

  /** Liveness: the process is up and able to answer HTTP requests. */
  @Get()
  liveness(): LivenessReport {
    return {
      status: 'ok',
      service: SERVICE_NAME,
      environment: this.env.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness: probes the owned database; 503 when it is unreachable. */
  @Get('ready')
  async readiness(): Promise<ReadinessReport> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        ...this.liveness(),
        status: 'error',
        checks: [{ name: 'database', status: 'down' }],
      });
    }

    return {
      ...this.liveness(),
      checks: [{ name: 'database', status: 'up' }],
    };
  }
}
