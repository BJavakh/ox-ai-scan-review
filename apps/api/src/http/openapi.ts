import {
  apiErrorBodySchema,
  createScanRequestSchema,
  createScanResponseSchema,
  healthResponseSchema,
  reportSchema,
  scanListResponseSchema,
  scanSchema,
} from '@ox-scan/shared';
import { z } from 'zod';

/** JSON Schema for a component, without the per-document `$schema` keyword. */
function component(schema: z.ZodType, io: 'input' | 'output' = 'output'): Record<string, unknown> {
  const json = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io,
    // Refinements without a JSON Schema equivalent become "any value" instead of throwing.
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (name: string) => ({ 'application/json': { schema: ref(name) } });
const error = (description: string) => ({ description, content: json('ApiError') });

const scanIdParameter = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

/**
 * OpenAPI 3.1 document generated from the shared Zod schemas that the API and the browser
 * already validate with, so it cannot drift from the implementation. Served at
 * GET /api/openapi.json; docs/API.md is the narrative version.
 */
export function buildOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Scan Review API',
      version: '1.0.0',
      description:
        'Scans the npm dependencies of a public GitHub repository against OSV.dev and returns prioritized upgrade actions. All errors use the ApiError envelope.',
    },
    paths: {
      '/api/scans': {
        post: {
          summary: 'Start a scan, or join the identical one in flight',
          requestBody: { required: true, content: json('CreateScanRequest') },
          responses: {
            '202': { description: 'Scan queued', content: json('CreateScanResponse') },
            '200': {
              description: 'An identical scan is already running; its ID is returned',
              content: json('CreateScanResponse'),
            },
            '400': error('Invalid body or repository URL'),
            '413': error('Body over 16 KB'),
            '415': error('Body is not JSON'),
            '429': error('Rate limit or hourly scan quota reached'),
            '503': error('Queue full or server shutting down'),
          },
        },
        get: {
          summary: "The caller's recent scans, newest first",
          responses: { '200': { description: 'Recent scans', content: json('ScanList') } },
        },
      },
      '/api/scans/{id}': {
        get: {
          summary: 'Scan status, progress and steps',
          parameters: [scanIdParameter],
          responses: {
            '200': { description: 'The scan', content: json('Scan') },
            '400': error('Malformed ID'),
            '404': error('Unknown scan'),
          },
        },
      },
      '/api/scans/{id}/report': {
        get: {
          summary: 'The report of a completed scan',
          parameters: [scanIdParameter],
          responses: {
            '200': { description: 'The report', content: json('Report') },
            '404': error('Unknown scan'),
            '409': error('The scan has not completed'),
          },
        },
      },
      '/api/scans/{id}/events': {
        get: {
          summary: 'Live progress as Server-Sent Events',
          description:
            'Sends a `snapshot` event with the current Scan, then `step`, `progress`, and a terminal `completed` or `failed` event, then closes. A comment heartbeat is sent every 15 s.',
          parameters: [scanIdParameter],
          responses: {
            '200': { description: 'Event stream', content: { 'text/event-stream': {} } },
            '404': error('Unknown scan'),
            '429': error('Too many open streams'),
          },
        },
      },
      '/api/health': {
        get: {
          summary: 'Liveness and mode',
          responses: { '200': { description: 'Healthy', content: json('Health') } },
        },
      },
    },
    components: {
      schemas: {
        CreateScanRequest: component(createScanRequestSchema, 'input'),
        CreateScanResponse: component(createScanResponseSchema),
        Scan: component(scanSchema),
        ScanList: component(scanListResponseSchema),
        Report: component(reportSchema),
        Health: component(healthResponseSchema),
        ApiError: component(apiErrorBodySchema),
      },
    },
  };
}
