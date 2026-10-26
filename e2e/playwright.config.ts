import { defineConfig, devices } from '@playwright/test';

// Own ports and offline fixtures, so the suite never touches a dev server you have running.
const API_PORT = 8797;
const WEB_PORT = 5190;

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${String(WEB_PORT)}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev -w @ox-scan/api',
      url: `http://127.0.0.1:${String(API_PORT)}/api/health`,
      cwd: '..',
      reuseExistingServer: false,
      env: {
        SCANNER_MODE: 'mock',
        PORT: String(API_PORT),
        WEB_ORIGIN: `http://localhost:${String(WEB_PORT)}`,
        LOG_LEVEL: 'warn',
        GITHUB_TOKEN: '',
        ANTHROPIC_API_KEY: '',
      },
    },
    {
      command: 'npm run dev -w @ox-scan/web',
      url: `http://localhost:${String(WEB_PORT)}`,
      cwd: '..',
      reuseExistingServer: false,
      env: { WEB_PORT: String(WEB_PORT), API_PORT: String(API_PORT) },
    },
  ],
});
