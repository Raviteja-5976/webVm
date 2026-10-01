import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

/**
 * Two projects:
 *  - mock: fast UI + lifecycle checks with the in-memory mock engine
 *  - vm:   the full acceptance flow on a real CheerpX Linux VM (needs network)
 * Run `npm run build` first; the suite starts `next start`.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices["Desktop Chrome"],
    viewport: { width: 1400, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mock", testMatch: /mock\.spec\.ts/, timeout: 60_000 },
    { name: "vm", testMatch: /vm\.spec\.ts/, timeout: 6 * 60_000 },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
