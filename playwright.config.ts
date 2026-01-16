import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  webServer: {
    command: "npm run dev -- --host 0.0.0.0 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
});
