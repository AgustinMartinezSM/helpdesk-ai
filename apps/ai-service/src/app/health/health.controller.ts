import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { APP_ENV, SERVICE_NAME, type AiServiceEnv } from '../../config/env';
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
  /** Which provider would answer right now — visible without a token so
   * operators can tell a misconfigured deployment from a healthy one. */
  provider: string;
}

@Controller('health')
export class HealthController {
  constructor(
    @Inject(APP_ENV) private readonly env: AiServiceEnv,
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

  /**
   * Readiness: probes the owned database; 503 when it is unreachable.
   *
   * The provider is NOT probed. A readiness check that called a paid model
   * on every poll would bill for monitoring, and an outage there degrades
   * one feature rather than making the service unable to serve requests.
   */
  @Get('ready')
  async readiness(): Promise<ReadinessReport> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        ...this.liveness(),
        status: 'error',
        provider: this.env.AI_PROVIDER,
        checks: [{ name: 'database', status: 'down' }],
      });
    }

    return {
      ...this.liveness(),
      provider: this.env.AI_PROVIDER,
      checks: [{ name: 'database', status: 'up' }],
    };
  }
}
