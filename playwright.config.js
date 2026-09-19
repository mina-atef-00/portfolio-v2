// Playwright config — Chromium smoke + accessibility suite.
//
// The page is static, so there is no build step: tests/serve.js (a zero-dependency
// Node http server) is booted as the webServer and serves this directory, exactly
// as Netlify will. The same suite runs at 375 / 768 / 1440 CSS pixels.
//
//   npm run test:e2e           # all three viewports
//   npx playwright test --project=desktop-1440
//   npx playwright test --ui  # local authoring

// @ts-check
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 4173);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * The three breakpoints the design is verified against. `mobile` adds touch /
 * isMobile emulation so the meta-viewport and tap-target behaviour are exercised.
 */
const VIEWPORTS = [
  { name: 'mobile-375', width: 375, height: 812, mobile: true },
  { name: 'tablet-768', width: 768, height: 1024, mobile: false },
  { name: 'desktop-1440', width: 1440, height: 900, mobile: false },
];

export default defineConfig({
  testDir: './tests',
  // Only the Playwright specs. Vitest owns `*.test.js`, so the two suites never
  // steal each other's files (vitest.config.js excludes these in return).
  testMatch: ['**/smoke.spec.js', '**/a11y.spec.js', '**/*.e2e.spec.js'],

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 5_000 },

  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: VIEWPORTS.map(({ name, width, height, mobile }) => ({
    name,
    use: {
      browserName: 'chromium',
      viewport: { width, height },
      ...(mobile
        ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
        : {}),
    },
  })),

  webServer: {
    command: `node tests/serve.js --port ${PORT}`,
    url: `${BASE_URL}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
