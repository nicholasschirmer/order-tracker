import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

/**
 * End-to-end tests run against the REAL stack:
 *  - the ASP.NET Core API on :5080 with a throw-away SQLite database (recreated on every run)
 *  - the Angular dev server on :4200, proxying /api to the API
 * Tests run in a single worker, in file order, so `01-empty-state` always sees an empty database.
 */
const dbDir = path.resolve(__dirname, 'e2e/.tmp');
const dbPath = path.join(dbDir, 'e2e-orders.db');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: [
    {
      command: `mkdir -p "${dbDir}" && rm -f "${dbPath}" "${dbPath}-wal" "${dbPath}-shm" && dotnet run --project ../backend/src/OrderTracker.Api --no-launch-profile`,
      url: 'http://localhost:5080/health',
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        ...process.env,
        ASPNETCORE_URLS: 'http://localhost:5080',
        ASPNETCORE_ENVIRONMENT: 'Development',
        ConnectionStrings__Orders: `Data Source=${dbPath}`,
      },
    },
    {
      command: 'npx ng serve --port 4200 --no-open',
      url: 'http://localhost:4200',
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
