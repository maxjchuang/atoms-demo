import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const real = process.env.ATOMS_E2E_REAL === '1';
const mockPort = process.env.ATOMS_MOCK_PORT ?? '5183';
const chrome = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ?? (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
export default defineConfig({
  testDir: './e2e', timeout: real ? 300000 : 45000, fullyParallel: false, workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.ATOMS_WEB_URL ?? `http://localhost:${real ? '5173' : mockPort}`, viewport: { width: 1440, height: 1000 },
    launchOptions: chrome ? { executablePath: chrome } : {}, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: real ? undefined : { command: `pnpm dev:mock --port ${mockPort}`, url: `http://localhost:${mockPort}`, reuseExistingServer: false, timeout: 30000 },
});
