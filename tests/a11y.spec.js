// Accessibility tests — axe (WCAG A/AA) plus a few structural guarantees.
//
// Runs at all three viewports. `critical` and `serious` axe violations fail the
// build (the design gate); everything else is attached to the report so it is
// still reviewable without being a hard blocker. Colour-contrast issues surface
// as `serious` and will block — that is intentional for a public portfolio.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];
const BLOCKING_IMPACTS = new Set(['critical', 'serious']);

test.describe('accessibility', () => {
  test('axe: no critical or serious WCAG violations', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

    await testInfo.attach('axe-results.json', {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json',
    });

    const blocking = results.violations.filter((violation) =>
      BLOCKING_IMPACTS.has(violation.impact ?? ''),
    );

    const report = blocking
      .map((violation) => {
        const nodes = violation.nodes
          .slice(0, 3)
          .map((node) => `      ${node.target.join(' ')}`)
          .join('\n');
        return `  ${violation.impact} ${violation.id}: ${violation.help}\n${nodes}`;
      })
      .join('\n');

    expect(
      blocking.map((violation) => violation.id),
      `\n${report}\n`,
    ).toEqual([]);
  });

  test('document exposes a language and a single main landmark', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', /^[a-z]{2}/i);
    await expect(page.locator('main')).toHaveCount(1);
  });

  test('has no duplicate ids (they break anchors and aria references)', async ({ page }) => {
    await page.goto('/');
    const duplicates = await page.evaluate(() => {
      const seen = new Map();
      for (const element of document.querySelectorAll('[id]')) {
        seen.set(element.id, (seen.get(element.id) ?? 0) + 1);
      }
      return [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
    });
    expect(duplicates, `duplicate ids: ${duplicates.join(', ')}`).toEqual([]);
  });

  test('interactive controls have accessible names', async ({ page }) => {
    await page.goto('/');
    const unnamed = await page.evaluate(() => {
      const selector = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"]';
      return [...document.querySelectorAll(selector)]
        .filter((element) => {
          const label =
            element.getAttribute('aria-label') ??
            element.getAttribute('aria-labelledby') ??
            element.getAttribute('title') ??
            '';
          const text = (element.textContent ?? '').trim();
          const imageAlt = (element.querySelector('img[alt]')?.getAttribute('alt') ?? '').trim();
          const value = (element.getAttribute('value') ?? '').trim();
          return [label, text, imageAlt, value].every((candidate) => candidate === '');
        })
        .map((element) => element.outerHTML.slice(0, 90));
    });
    expect(unnamed, `controls without an accessible name:\n${unnamed.join('\n')}`).toEqual([]);
  });

  test('images declare alt text and headings are non-empty', async ({ page }) => {
    await page.goto('/');

    const imagesWithoutAlt = await page.$$eval('img', (images) =>
      images.filter((image) => image.getAttribute('alt') === null).length,
    );
    expect(imagesWithoutAlt).toBe(0);

    const emptyHeadings = await page.$$eval('h1, h2, h3, h4, h5, h6', (headings) =>
      headings
        .filter((heading) => (heading.textContent ?? '').trim() === '' &&
          (heading.getAttribute('aria-label') ?? '').trim() === '')
        .map((heading) => heading.outerHTML.slice(0, 80)),
    );
    expect(emptyHeadings, `empty headings:\n${emptyHeadings.join('\n')}`).toEqual([]);
  });

  test('keyboard: Tab moves focus off the body', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const active = await page.evaluate(() => document.activeElement?.tagName ?? null);
    expect(active, 'nothing on the page is keyboard-focusable').not.toBe('BODY');
  });
});
