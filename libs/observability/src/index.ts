export * from './lib/correlation.js';
export * from './lib/observability.module.js';

// Re-exported so services take the Nest logger integration from one place
// and stay decoupled from the concrete logging package.
export { Logger, LoggerErrorInterceptor } from 'nestjs-pino';
