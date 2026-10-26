import { resolve } from 'node:path';
import { loadEnv } from './config/env.js';
import { buildApp } from './http/app.js';

loadDotEnv();
const env = loadEnv();
const { app, services } = await buildApp(env);

app.log.info(
  {
    mode: env.SCANNER_MODE,
    aiSummaries: services.summaries.aiEnabled,
    githubToken: Boolean(env.GITHUB_TOKEN),
  },
  'starting AI Scan Review API',
);

/** Hard stop if graceful shutdown hangs, so an orchestrator restart is never blocked. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

const lifecycle = { stopping: false };

/** Idempotent: a second signal or crash during shutdown only logs. */
function shutdown(reason: string, exitCode: number): void {
  if (lifecycle.stopping) return;
  lifecycle.stopping = true;
  app.log.info({ reason }, 'shutting down');
  setTimeout(() => {
    app.log.error('graceful shutdown timed out, forcing exit');
    process.exit(exitCode || 1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
  app.close().then(
    () => process.exit(exitCode),
    (error: unknown) => {
      app.log.error({ err: error }, 'error during shutdown');
      process.exit(1);
    },
  );
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    shutdown(signal, 0);
  });
}

// The process state is unknown after either of these: log with context, drain what we can,
// and exit non-zero so the supervisor (Docker, Kubernetes, systemd) restarts a clean process.
process.on('unhandledRejection', (reason) => {
  app.log.fatal({ err: reason }, 'unhandled promise rejection');
  shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (error) => {
  app.log.fatal({ err: error }, 'uncaught exception');
  shutdown('uncaughtException', 1);
});

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
