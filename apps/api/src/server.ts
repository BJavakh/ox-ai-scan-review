import { resolve } from 'node:path';
import { loadEnv } from './config/env.js';
import { buildApp } from './http/app.js';

loadDotEnv();
const env = loadEnv();
const app = buildApp(env);

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.fatal(error, 'failed to start');
  process.exit(1);
}

/** Load the repo-root .env if present. Existing env vars win. */
function loadDotEnv(): void {
  try {
    process.loadEnvFile(resolve(import.meta.dirname, '../../../.env'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
