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
  SCAN_TIMEOUT_MS: intInRange(5_000, 600_000, 120_000),
  LLM_TIMEOUT_MS: intInRange(1_000, 120_000, 20_000),
  SCAN_CONCURRENCY: intInRange(1, 16, 2),
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
