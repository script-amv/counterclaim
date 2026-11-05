import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      'node scripts/prepare-e2e.mjs && DATABASE_PATH=./data/e2e.db OPERATOR_CODE=local-e2e-only NODE_OPTIONS="--require ./scripts/offline.cjs" npm start -- --hostname 127.0.0.1 --port 3100',
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    timeout: 120000,
  },
  reporter: [["list"]],
});
