import { Controller, Get, Inject } from '@nestjs/common';
import { APP_ENV, SERVICE_NAME, type AuthServiceEnv } from '../../config/env';

interface LivenessReport {
  status: 'ok';
  service: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
}

interface ReadinessReport extends LivenessReport {
  /**
   * External dependencies actually probed for readiness. Empty on purpose:
   * the service does not talk to its database yet (persistence tooling is
   * pending ADR-0004), and reporting a dependency that is never probed
   * would make readiness lie.
   */
  checks: string[];
}

@Controller('health')
export class HealthController {
  constructor(@Inject(APP_ENV) private readonly env: AuthServiceEnv) {}

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

  /** Readiness: liveness plus the state of probed dependencies (none yet). */
  @Get('ready')
  readiness(): ReadinessReport {
    return { ...this.liveness(), checks: [] };
  }
}
