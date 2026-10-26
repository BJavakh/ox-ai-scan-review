import type { FastifyInstance } from 'fastify';
import { createScanRequestSchema, scanIdParamsSchema } from '@ox-scan/shared';
import type { z } from 'zod';
import type { Services } from '../../container.js';
import { clientKey } from '../clientKey.js';
import { AppError } from '../errors.js';
import { type StreamLimiter, streamScanEvents } from '../sse.js';

function validationError(error: z.ZodError): AppError {
  return new AppError(400, 'VALIDATION_ERROR', 'The request is not valid.', {
    issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  });
}

function parseId(params: unknown): string {
  const result = scanIdParamsSchema.safeParse(params);
  if (!result.success) throw validationError(result.error);
  return result.data.id;
}

export function registerScanRoutes(
  app: FastifyInstance,
  services: Services,
  limiter: StreamLimiter,
  heartbeatMs?: number,
): void {
  app.post(
    '/api/scans',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = createScanRequestSchema.safeParse(request.body);
      if (!body.success) throw validationError(body.error);
      const { scan, deduplicated } = await services.service.submit(
        body.data.repoUrl,
        clientKey(request.ip),
      );
      return reply
        .code(deduplicated ? 200 : 202)
        .send({ scanId: scan.id, status: scan.status, deduplicated });
    },
  );

  app.get('/api/scans', async () => ({ scans: await services.service.listRecent() }));

  app.get('/api/scans/:id', async (request) => services.service.get(parseId(request.params)));

  app.get('/api/scans/:id/report', async (request) =>
    services.service.report(parseId(request.params)),
  );

  app.get('/api/scans/:id/events', async (request, reply) => {
    await streamScanEvents(services, limiter, request, reply, parseId(request.params), heartbeatMs);
  });
}
