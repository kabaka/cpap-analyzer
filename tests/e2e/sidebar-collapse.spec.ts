import { test, expect, type Page } from '@playwright/test';

/**
 * Collapsible left sidebar ("rail") — desktop behaviour (viewport ≥ 768px).
 *
 * The sidebar (`aside[aria-label="Main navigation"]`) can collapse from its
 * expanded ~240px width to a narrow 64px icon-only rail and expand back. A
 * toggle button pinned in the sidebar FOOTER drives this; it is a real
 * `type=button` whose `aria-pressed` mirrors the collapsed state and whose
 * accessible name is state-reflective:
 *
 *   - expanded  → aria-pressed="false", name "Collapse sidebar"
 *   - collapsed → aria-pressed="true",  name "Expand sidebar"
 *
 * The `[` keyboard shortcut toggles on desktop but is ignored while focus is in
 * a text input. State persists across reload via the `cpap-theme` localStorage
 * key (now `{ theme, sidebarCollapsed }`).
 *
 * These assertions are deliberately semantic — aria-pressed, accessible name,
 * link accessible names, the landmark, and the aside's *rendered* width via
 * boundingBox — rather than hashed CSS-module class names, so they tolerate
 * visual/layout tweaks. All width comparisons auto-retry (expect.poll) to ride
 * out the collapse/expand transition without arbitrary waits.
 *
 * The default Playwright desktop projects (chromium/firefox/webkit) use a
 * ≥768px viewport, so the rail UI — not the mobile drawer — is in play here.
 */

const RAIL_MAX_WIDTH = 96; // collapsed rail is ~64px; generous ceiling for borders/scrollbars
const EXPANDED_MIN_WIDTH = 180; // expanded is ~240px; comfortably above the rail ceiling

const sidebar = (page: Page) => page.locator('aside[aria-label="Main navigation"]');

/** The rail toggle pinned in the sidebar footer (NOT the mobile hamburger). */
const railToggle = (page: Page) =>
  page.getByRole('button', { name: /collapse sidebar|expand sidebar/i });

/** Current rendered width of the sidebar aside, in CSS pixels (null if absent). */
async function sidebarWidth(page: Page): Promise<number> {
  const box = await sidebar(page).boundingBox();
  return box?.width ?? -1;
}

/**
 * Poll the sidebar's rendered width until it is within the collapsed rail band.
 * Rides out the collapse transition without an arbitrary timeout.
 */
async function expectCollapsedWidth(page: Page): Promise<void> {
  await expect
    .poll(() => sidebarWidth(page), { timeout: 3000 })
    .toBeLessThanOrEqual(RAIL_MAX_WIDTH);
}

/** Poll the sidebar's rendered width until it is within the expanded band. */
async function expectExpandedWidth(page: Page): Promise<void> {
  await expect
    .poll(() => sidebarWidth(page), { timeout: 3000 })
    .toBeGreaterThanOrEqual(EXPANDED_MIN_WIDTH);
}

test.describe('Collapsible sidebar (desktop rail)', () => {
  test('defaults to expanded with a "Collapse sidebar" toggle and visible labels', async ({
    page,
  }) => {
    await page.goto('/');

    const toggle = railToggle(page);
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('type', 'button');

    // Expanded contract: not pressed, name invites collapsing.
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toHaveAccessibleName(/collapse sidebar/i);

    // Text labels are rendered when expanded.
    const nav = sidebar(page);
    await expect(nav.getByText('Dashboard', { exact: true })).toBeVisible();
    await expect(nav.getByText('Sessions', { exact: true })).toBeVisible();

    // Sanity: the aside is at its full width.
    await expectExpandedWidth(page);
  });

  test('clicking the toggle collapses to a narrow rail and updates the toggle semantics', async ({
    page,
  }) => {
    await page.goto('/');

    const toggle = railToggle(page);
    await expectExpandedWidth(page);

    await toggle.click();

    // Collapsed contract: pressed, name now invites expanding.
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveAccessibleName(/expand sidebar/i);

    // The aside has visibly narrowed to the icon-only rail.
    await expectCollapsedWidth(page);
    expect(await sidebarWidth(page)).toBeLessThan(EXPANDED_MIN_WIDTH);

    // Even with the text label hidden, the nav link keeps its accessible name
    // (carried by aria-label), so it remains reachable for AT and tests.
    await expect(sidebar(page).getByRole('link', { name: 'Sessions' })).toBeVisible();
  });

  test('clicking the toggle again expands back to the full sidebar', async ({ page }) => {
    await page.goto('/');

    const toggle = railToggle(page);

    // Collapse first.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expectCollapsedWidth(page);

    // Expand back.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toHaveAccessibleName(/collapse sidebar/i);
    await expectExpandedWidth(page);

    // Text labels are visible again.
    await expect(sidebar(page).getByText('Dashboard', { exact: true })).toBeVisible();
  });

  test('the "[" shortcut toggles on desktop but is ignored while typing in an input', async ({
    page,
  }) => {
    await page.goto('/help');

    const toggle = railToggle(page);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    // Move focus to the document body (off any control), then press "[".
    await page.locator('body').click({ position: { x: 2, y: 2 } });
    await page.keyboard.press('[');

    // The shortcut collapses the sidebar.
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expectCollapsedWidth(page);

    // Press "[" again from the body to expand back, proving the toggle is live.
    await page.locator('body').click({ position: { x: 2, y: 2 } });
    await page.keyboard.press('[');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expectExpandedWidth(page);

    // Now focus a text input and press "[": the shortcut must be ignored so the
    // bracket can be typed normally without nuking the user's layout.
    const searchInput = page.getByLabel(/search help topics/i);
    await searchInput.click();
    await expect(searchInput).toBeFocused();
    await page.keyboard.press('[');

    // State is unchanged: still expanded.
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expectExpandedWidth(page);
  });

  test('the collapsed state persists across a reload', async ({ page }) => {
    await page.goto('/');

    const toggle = railToggle(page);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expectCollapsedWidth(page);

    await page.reload();

    // After reload the sidebar is restored from localStorage in the collapsed state.
    const toggleAfter = railToggle(page);
    await expect(toggleAfter).toHaveAttribute('aria-pressed', 'true');
    await expect(toggleAfter).toHaveAccessibleName(/expand sidebar/i);
    await expectCollapsedWidth(page);

    // The persisted preference lives under the cpap-theme key.
    const stored = await page.evaluate(() => window.localStorage.getItem('cpap-theme'));
    expect(stored, 'cpap-theme should be persisted in localStorage').not.toBeNull();
    expect(stored!).toContain('sidebarCollapsed');
  });

  test('regression: single Primary nav landmark persists and the rail toggle is not the mobile hamburger', async ({
    page,
  }) => {
    await page.goto('/');

    // The single primary navigation landmark still resolves (expanded)...
    const primaryNav = page.getByRole('navigation', { name: 'Primary' });
    await expect(primaryNav).toBeVisible();

    // ...and remains the sole match after collapsing to the rail.
    await railToggle(page).click();
    await expect(railToggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expectCollapsedWidth(page);
    await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(1);

    // The rail toggle is distinct from the mobile hamburger: on desktop the
    // hamburger (name /navigation menu/i) is not present, and the rail toggle's
    // name does not match it.
    await expect(page.getByRole('button', { name: /navigation menu/i })).toHaveCount(0);
    await expect(railToggle(page)).not.toHaveAccessibleName(/navigation menu/i);
  });
});
