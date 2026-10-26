import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Env } from '../config/env.js';
import { type ContainerOverrides, type Services, createContainer } from '../container.js';
import { clientKey } from './clientKey.js';
import { AppError } from './errors.js';
import { registerScanRoutes } from './routes/scans.js';
import { StreamLimiter } from './sse.js';

const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/;
/** How long shutdown waits for aborted scans to record their final state. */
export const SHUTDOWN_DRAIN_MS = 5_000;

export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'headers.authorization',
  'headers["x-api-key"]',
  '*.token',
  '*.apiKey',
  '*.GITHUB_TOKEN',
  '*.ANTHROPIC_API_KEY',
];

export interface BuildAppOptions extends ContainerOverrides {
  heartbeatMs?: number;
  shutdownDrainMs?: number;
}

function toAppError(error: FastifyError | AppError): AppError | null {
  if (error instanceof AppError) return error;
  switch (error.statusCode) {
    case 400:
      return new AppError(400, 'VALIDATION_ERROR', 'The request body is not valid JSON.');
    case 413:
      return new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');
    case 415:
      return new AppError(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'Send the request body as application/json.',
      );
    case 429:
      return new AppError(429, 'RATE_LIMITED', 'Too many requests. Slow down and retry shortly.');
    default:
      // Any other client error from the framework (405, 406, ...) keeps its status with a
      // generic code. Only real server faults fall through to the 500 path.
      return error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500
        ? new AppError(error.statusCode, 'BAD_REQUEST', 'The request could not be processed.')
        : null;
  }
}

/** Resolves true if `promise` settles within `ms`, false on timeout. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, ms);
  });
  try {
    return await Promise.race([promise.then(() => true as const), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function buildApp(
  env: Env,
  options: BuildAppOptions = {},
): Promise<{ app: FastifyInstance; services: Services }> {
  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: env.LOG_LEVEL, redact: LOG_REDACT_PATHS },
    bodyLimit: 16 * 1024,
    // Requests during shutdown get the standard error envelope from the hook below instead.
    return503OnClosing: false,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    },
  });
  const services = createContainer(env, app.log, options);
  const streams = new StreamLimiter();
  // An object, not a `let`: it is flipped from a hook while other hooks read it.
  const lifecycle = { closing: false };
  // JSON only: Fastify parses text/plain by default, which would widen the input surface.
  app.removeContentTypeParser('text/plain');

  app.addHook('onRequest', (request, reply, done) => {
    reply.header('x-request-id', request.id);
    if (lifecycle.closing) {
      done(new AppError(503, 'SERVICE_BUSY', 'The server is restarting. Retry in a few seconds.'));
      return;
    }
    done();
  });

  // Graceful shutdown, before the listener closes: refuse new work, stop scans so each one
  // records a retryable final state, then end the progress streams that are still open.
  app.addHook('preClose', async () => {
    lifecycle.closing = true;
    const abortedScans = services.orchestrator.shutdown();
    const drained = await settlesWithin(
      services.queue.onIdle(),
      options.shutdownDrainMs ?? SHUTDOWN_DRAIN_MS,
    );
    const closedStreams = streams.closeAll();
    app.log.info({ abortedScans, drained, closedStreams }, 'shutdown: scans stopped');
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
  });
  await app.register(cors, {
    origin: env.WEB_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: false,
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request) => clientKey(request.ip),
    errorResponseBuilder: () =>
      new AppError(429, 'RATE_LIMITED', 'Too many requests. Slow down and retry shortly.'),
  });

  app.setErrorHandler<FastifyError | AppError>((error, request, reply) => {
    const known = toAppError(error);
    if (!known) {
      request.log.error({ err: error }, 'unhandled error');
      return reply
        .code(500)
        .send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
    }
    const body = {
      code: known.code,
      message: known.message,
      ...(known.details ? { details: known.details } : {}),
    };
    return reply.code(known.statusCode).send({ error: body });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.' } }),
  );

  app.get('/api/health', { config: { rateLimit: false } }, () => ({
    status: 'ok' as const,
    mode: env.SCANNER_MODE,
    aiSummaries: services.summaries.aiEnabled,
  }));

  registerScanRoutes(app, services, streams, options.heartbeatMs);
  return { app, services };
}
