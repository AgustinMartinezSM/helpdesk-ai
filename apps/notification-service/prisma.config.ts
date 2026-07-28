import { defineConfig, env } from 'prisma/config';

// DATABASE_URL comes from the process environment: Nx loads the project
// .env when serving; for CLI commands set the variable in the shell.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
