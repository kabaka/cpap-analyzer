import { test, expect, type Page } from '@playwright/test';

/**
 * Accessibility behaviours introduced by the Phase 1 chrome redesign:
 *
 *  - A skip-to-content link that is visually hidden until focused and targets
 *    `<main id="main-content">`.
 *  - Mobile drawer focus management: opening the hamburger moves focus into the
 *    drawer and traps Tab; Escape closes it and restores focus to the hamburger.
 *  - Keyboard operability of the theme dropdown.
 *
 * These assertions are deliberately behavioural (focus, attributes, geometry)
 * rather than style-based, so they tolerate visual/layout tweaks.
 */

const MOBILE = { width: 375, height: 667 };

const skipLink = (page: Page) => page.getByRole('link', { name: /skip to main content/i });
const hamburger = (page: Page) => page.getByRole('button', { name: /navigation menu/i });

/**
 * Press ArrowDown until the given menu option holds roving focus. The menu must
 * already be open. Robust against which item Radix focuses on open.
 */
async function focusOptionWithArrows(
  page: Page,
  option: ReturnType<Page['getByRole']>,
): Promise<void> {
  for (let i = 0; i < 4; i++) {
    if (await option.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('ArrowDown');
  }
  await expect(option).toBeFocused();
}

test.describe('Skip-to-content link', () => {
  test('is the first focusable element and is visually hidden until focused', async ({ page }) => {
    await page.goto('/');

    const link = skipLink(page);
    await expect(link).toHaveAttribute('href', '#main-content');

    // Hidden state: positioned off the top of the viewport (translateY(-200%)).
    const hiddenBox = await link.boundingBox();
    expect(hiddenBox).not.toBeNull();
    expect(hiddenBox!.y).toBeLessThan(0);

    // First Tab from the document body lands on the skip link...
    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();

    // ...and the link animates on-screen once focused.
    await expect
      .poll(async () => (await link.boundingBox())?.y ?? -1, { timeout: 2000 })
      .toBeGreaterThanOrEqual(0);
  });

  test('points at the main content region', async ({ page }) => {
    await page.goto('/');

    const link = skipLink(page);
    // The link references the in-page main-content fragment...
    await expect(link).toHaveAttribute('href', '#main-content');

    // ...and that target exists and is the <main> landmark wrapping the route,
    // so activating the link lands the user on the primary content region.
    // (Focus is not moved programmatically — <main> is not a focus target — and
    // the app's URL-state sync reclaims the location hash, so we assert the
    // durable structural contract rather than a transient :target/hash.)
    const main = page.getByRole('main');
    await expect(main).toBeVisible();
    await expect(main).toHaveAttribute('id', 'main-content');
  });
});

test.describe('Mobile navigation drawer focus management', () => {
  test.use({ viewport: MOBILE });

  test('opening the drawer moves focus into it', async ({ page }) => {
    await page.goto('/');

    const ham = hamburger(page);
    await expect(ham).toHaveAttribute('aria-expanded', 'false');

    await ham.click();
    await expect(ham).toHaveAttribute('aria-expanded', 'true');

    // Focus is moved into the sidebar drawer (its first focusable, the brand link).
    const sidebar = page.locator('aside[aria-label="Main navigation"]');
    await expect
      .poll(() => sidebar.evaluate((el) => el.contains(document.activeElement)), { timeout: 2000 })
      .toBe(true);
  });

  test('Escape closes the drawer and restores focus to the hamburger', async ({ page }) => {
    await page.goto('/');

    const ham = hamburger(page);
    await ham.click();
    await expect(ham).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('Escape');

    await expect(ham).toHaveAttribute('aria-expanded', 'false');
    // The hamburger toggles its accessible name when closed; focus returns to it.
    const restored = page.getByRole('button', { name: /open navigation menu/i });
    await expect(restored).toBeFocused();
  });

  test('Tab is trapped within the open drawer', async ({ page }) => {
    await page.goto('/');

    await hamburger(page).click();
    const sidebar = page.locator('aside[aria-label="Main navigation"]');

    // Tab repeatedly; focus must never escape the drawer while it is open.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const inside = await sidebar.evaluate((el) => el.contains(document.activeElement));
      expect(inside, `focus left the drawer on Tab #${i + 1}`).toBe(true);
    }
  });
});

test.describe('Theme dropdown keyboard operability', () => {
  test('opens and selects an option entirely via the keyboard', async ({ page }) => {
    await page.goto('/');

    const trigger = page.getByRole('button', { name: /^Theme:/ });
    await trigger.focus();
    await expect(trigger).toBeFocused();

    // Open the menu from the keyboard.
    await page.keyboard.press('Enter');
    const options = page.getByRole('menuitemradio');
    await expect(options.first()).toBeVisible();
    await expect(options).toHaveCount(3);

    // Arrow down until the Dark option holds roving focus, then activate it.
    // Polling on the focused option (rather than assuming which item Radix
    // focuses on open) keeps this deterministic under parallel load.
    const dark = page.getByRole('menuitemradio', { name: /^Dark/ });
    await focusOptionWithArrows(page, dark);
    await page.keyboard.press('Enter');

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(trigger).toHaveAttribute('aria-label', 'Theme: Dark');
  });
});
