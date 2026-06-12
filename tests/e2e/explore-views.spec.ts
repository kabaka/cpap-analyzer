import { test, expect } from '@playwright/test';

/**
 * Light smoke coverage for Explore-hub surfaces introduced by the
 * `feat/health-viz-breathing-detection` branch.
 *
 * Goals (intentionally narrow — these views render rich state-driven UIs
 * with empty/insufficient-history fallbacks, and we only confirm here that
 * each one mounts on a fresh DB without crashing and exposes its core
 * landmarks):
 *
 *  1. `/explore` hub lists all five card titles and each card link resolves.
 *  2. `/explore/breathing` renders its page heading and the empty-history
 *     state for TECSA without throwing.
 *  3. `/explore/configs` renders its page heading and the empty-config
 *     fallback without throwing.
 *  4. `/explore/events` (Event Explorer) renders its heading and the
 *     no-events fallback without throwing.
 *  5. None of the above surfaces emit pageerror / console-error events
 *     beyond the known React Router future-flag noise.
 *
 * This spec works against an empty IndexedDB — no fixtures required.
 */

const EXPLORE_CARD_TITLES = [
  'Event Explorer',
  'Correlations',
  'Pressure Optimization',
  'Breathing Patterns',
  'Machine Configurations',
] as const;

// Console messages that are pre-existing noise and not regressions.
const KNOWN_NOISE = [/React Router/i, /Download the React DevTools/i, /\[vite\]/i];

function isRealError(text: string): boolean {
  return !KNOWN_NOISE.some((re) => re.test(text));
}

test.describe('Explore hub — card listing', () => {
  test('lists all five exploration cards with working links', async ({ page }) => {
    await page.goto('/explore');
    await expect(page.getByRole('heading', { name: /^explore$/i })).toBeVisible();

    for (const title of EXPLORE_CARD_TITLES) {
      // Card titles are h2 within the link.
      await expect(
        page.getByRole('heading', { name: new RegExp(`^${title}$`, 'i') }),
      ).toBeVisible();
    }

    // Each card is a link with accessible name "<title>: <description>"; spot
    // check one to make sure the navigation target itself is wired up.
    const breathingLink = page.getByRole('link', { name: /^Breathing Patterns:/ });
    await expect(breathingLink).toBeVisible();
    await breathingLink.click();
    await expect(page).toHaveURL(/\/explore\/breathing(\?|$)/);
    await expect(page.getByRole('heading', { name: /breathing patterns/i })).toBeVisible();
  });
});

test.describe('Explore — Breathing Patterns', () => {
  test('mounts on a fresh DB and shows the insufficient-history state', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });

    await page.goto('/explore/breathing');

    // Page heading
    await expect(page.getByRole('heading', { name: /breathing patterns/i })).toBeVisible();

    // TECSA section heading is always rendered (text content varies by state).
    await expect(page.getByRole('heading', { name: /tecsa trajectory/i })).toBeVisible();

    // Without any data the page should land in the "insufficient history"
    // honest-empty state. We accept either an explicit insufficient-history
    // message or the loading spinner that precedes it — the goal is that the
    // page does not crash.
    const insufficient = page.getByText(/insufficient history/i);
    const computing = page.getByText(/computing classification/i);
    await expect(insufficient.or(computing)).toBeVisible({ timeout: 10_000 });

    const real = errors.filter(isRealError);
    expect(real, `unexpected errors: ${real.join('\n')}`).toEqual([]);
  });
});

test.describe('Explore — Machine Configurations', () => {
  test('mounts on a fresh DB and renders the empty state', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });

    await page.goto('/explore/configs');

    await expect(page.getByRole('heading', { name: /machine configurations/i })).toBeVisible();

    // One of the three empty-state variants from Configurations.tsx must show.
    const emptyVariants = [
      /no therapy data in this range/i,
      /machine settings unavailable/i,
      /all nights share one configuration/i,
    ];
    const anyEmpty = emptyVariants.map((re) => page.getByText(re)).reduce((acc, l) => acc.or(l));
    await expect(anyEmpty).toBeVisible({ timeout: 10_000 });

    const real = errors.filter(isRealError);
    expect(real, `unexpected errors: ${real.join('\n')}`).toEqual([]);
  });
});

test.describe('Explore — Event Explorer', () => {
  test('mounts on a fresh DB without crashing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });

    await page.goto('/explore/events');

    // Heading is always present (loading / error / empty / ready all render
    // the same h1).
    await expect(page.getByRole('heading', { name: /^event explorer$/i })).toBeVisible();

    // With no data the page should land in either the loading spinner or the
    // no-events empty state.
    const loading = page.getByRole('status', { name: /loading event data/i });
    const empty = page.getByRole('heading', { name: /no events in this date range/i });
    await expect(loading.or(empty)).toBeVisible({ timeout: 10_000 });

    const real = errors.filter(isRealError);
    expect(real, `unexpected errors: ${real.join('\n')}`).toEqual([]);
  });
});

test.describe('Sessions list — empty state smoke', () => {
  test('Sessions list at /sessions renders cleanly on empty DB', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });

    await page.goto('/sessions');
    await expect(page.getByRole('heading', { name: /^sessions$/i })).toBeVisible();

    const real = errors.filter(isRealError);
    expect(real, `unexpected errors: ${real.join('\n')}`).toEqual([]);
  });
});
