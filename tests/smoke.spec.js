// Smoke tests — is the site actually a working page at every viewport?
//
// These run in all three Playwright projects (375 / 768 / 1440), so anything
// layout-sensitive is asserted per breakpoint. They are deliberately about
// structure and behaviour, not copy, so a content edit never needs a test edit.
import { test, expect } from '@playwright/test';

/** Browser noise we never want to fail the suite (favicon probes are harmless). */
const IGNORED_NOISE = /favicon\.ico/i;

test.describe('smoke', () => {
  test('serves a 200 HTML document', async ({ page }) => {
    const response = await page.goto('/');
    expect(response, 'no response for /').not.toBeNull();
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type'] ?? '').toContain('text/html');
  });

  test('has a title, a language and a viewport meta', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/\S/);
    expect((await page.title()).trim().length).toBeGreaterThan(3);

    await expect(page.locator('html')).toHaveAttribute('lang', /^[a-z]{2}/i);
    expect(await page.locator('meta[name="viewport"]').count()).toBeGreaterThan(0);
    expect(await page.locator('meta[charset], meta[http-equiv="content-type" i]').count())
      .toBeGreaterThan(0);
  });

  test('has exactly one h1 and one main landmark', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('main')).toHaveCount(1);
  });

  test('loads with no console errors or failed requests', async ({ page }) => {
    const problems = [];
    page.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error' && !IGNORED_NOISE.test(text)) {
        problems.push(`console.error: ${text}`);
      }
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) => {
      if (IGNORED_NOISE.test(request.url())) return;
      problems.push(`requestfailed: ${request.url()} (${request.failure()?.errorText ?? '?'})`);
    });

    await page.goto('/', { waitUntil: 'load' });
    await page.waitForLoadState('networkidle');

    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('applies stylesheets', async ({ page }) => {
    await page.goto('/');
    const sheetCount = await page.evaluate(() => document.styleSheets.length);
    expect(sheetCount, 'no stylesheet (inline or linked) was applied').toBeGreaterThan(0);
  });

  test('every in-page anchor resolves to an existing element', async ({ page }) => {
    await page.goto('/');

    const hrefs = await page.$$eval('a[href^="#"]', (links) =>
      links.map((link) => link.getAttribute('href')),
    );

    const missing = [];
    for (const href of new Set(hrefs)) {
      if (!href || href === '#') continue;
      const id = href.slice(1);
      if ((await page.locator(`[id="${id}"]`).count()) === 0) missing.push(href);
    }

    expect(missing, `anchors with no target: ${missing.join(', ')}`).toEqual([]);
  });

  test('outbound links are https and contact links are mailto', async ({ page }) => {
    await page.goto('/');

    const hrefs = await page.$$eval('a[href]', (links) =>
      links.map((link) => link.getAttribute('href') ?? ''),
    );

    const insecure = hrefs.filter((href) => /^http:\/\//i.test(href));
    expect(insecure, `non-https outbound links: ${insecure.join(', ')}`).toEqual([]);

    const malformed = hrefs.filter(
      (href) => href !== '' && !/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/|[a-z0-9_-]+\.(html|pdf))/i.test(href),
    );
    expect(malformed, `unexpected href schemes: ${malformed.join(', ')}`).toEqual([]);
  });

  test('every image declares alt text', async ({ page }) => {
    await page.goto('/');
    const missing = await page.$$eval('img', (images) =>
      images
        .filter((image) => image.getAttribute('alt') === null)
        .map((image) => image.getAttribute('src') ?? image.outerHTML.slice(0, 60)),
    );
    expect(missing, `images without an alt attribute: ${missing.join(', ')}`).toEqual([]);
  });

  test('does not overflow horizontally at this viewport', async ({ page }) => {
    await page.goto('/');
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      scrollWidth,
      `document is ${scrollWidth - clientWidth}px wider than the ${clientWidth}px viewport`,
    ).toBeLessThanOrEqual(clientWidth + 1);
  });

  test('core content exists without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    try {
      const response = await page.goto('/');
      expect(response.status()).toBe(200);
      expect((await page.locator('h1').innerText()).trim().length).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });
});
