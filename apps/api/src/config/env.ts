import { z } from 'zod';

/** Treat empty strings (e.g. `GITHUB_TOKEN=` in .env) as "not set". */
const optionalSecret = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional();

const intInRange = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SCANNER_MODE: z.enum(['live', 'mock']).default('live'),
  PORT: intInRange(1, 65_535, 8787),
  HOST: z.string().min(1).default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  WEB_ORIGIN: z.url({ protocol: /^https?$/ }).default('http://localhost:5180'),
  GITHUB_TOKEN: optionalSecret,
  ANTHROPIC_API_KEY: optionalSecret,
  ANTHROPIC_MODEL: z.string().trim().min(1).default('claude-sonnet-5-5'),
  SCAN_TIMEOUT_MS: intInRange(1_000, 600_000, 120_000),
  LLM_TIMEOUT_MS: intInRange(1_000, 120_000, 20_000),
  SCAN_CONCURRENCY: intInRange(1, 16, 2),
  /** New scans per client (IPv4 address or IPv6 /64) per hour. */
  SCANS_PER_HOUR: intInRange(1, 10_000, 30),
  /**
   * Reverse proxies in front of the API (0 = none). Counting hops, instead of trusting every
   * X-Forwarded-For entry, stops clients from spoofing their IP to dodge rate limits.
   */
  TRUST_PROXY_HOPS: intInRange(0, 5, 0),
  /** Absolute path of the built web app. When set, the API also serves it (single origin). */
  WEB_DIST_DIR: z.string().trim().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate the environment once at startup. Fails fast with a
 * message that names the bad variables but never echoes their values.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  return result.data;
}
