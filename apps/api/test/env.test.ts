import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

describe('loadEnv', () => {
  it('applies defaults when nothing is set', () => {
    const env = loadEnv({});
    expect(env.SCANNER_MODE).toBe('live');
    expect(env.PORT).toBe(8787);
    expect(env.HOST).toBe('127.0.0.1');
    expect(env.ANTHROPIC_MODEL).toBe('claude-sonnet-5-5');
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });

  it('treats empty secrets as unset', () => {
    const env = loadEnv({ GITHUB_TOKEN: '', ANTHROPIC_API_KEY: '  ' });
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('rejects invalid values without echoing secrets', () => {
    expect(() => loadEnv({ PORT: 'abc', SCANNER_MODE: 'prod' })).toThrow(
      /SCANNER_MODE.*PORT|PORT.*SCANNER_MODE/,
    );
    const attempt = () => loadEnv({ PORT: '0', ANTHROPIC_API_KEY: 'sk-secret-value' });
    expect(attempt).toThrow(/PORT/);
    expect(attempt).not.toThrow(/sk-secret-value/);
  });
});
