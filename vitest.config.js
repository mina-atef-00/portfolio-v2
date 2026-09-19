// Vitest config.
//
// Vitest's default include pattern also matches `*.spec.js`, which is exactly
// what the Playwright suite is called (tests/smoke.spec.js, tests/a11y.spec.js).
// Without this file `npm run test` would try to run the browser tests inside
// Vitest and blow up on the `@playwright/test` import.
//
// Playwright mirrors this: its `testMatch` only claims these two files.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{git,cache}/**',
      // Owned by Playwright (see playwright.config.js).
      'tests/smoke.spec.js',
      'tests/a11y.spec.js',
      '**/*.e2e.spec.js',
    ],
  },
});
