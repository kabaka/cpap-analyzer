import { test, expect, type Page } from '@playwright/test';

/**
 * Theme control is a dropdown menu (Phase 1 chrome redesign), not a cycling
 * button. The trigger is an icon button whose accessible name reflects the
 * active *setting* ("Theme: Light/Dark/System"). Opening it reveals three
 * `menuitemradio` options whose `aria-checked` mirrors the store, and selecting
 * one updates `data-theme` on <html> (set by `useThemeEffect`).
 *
 * "System" resolves via `prefers-color-scheme`. Playwright defaults to light,
 * so System resolves to light unless we `emulateMedia({ colorScheme: 'dark' })`.
 */

const themeTrigger = (page: Page) => page.getByRole('button', { name: /^Theme:/ });
const themeOption = (page: Page, name: 'Light' | 'Dark' | 'System') =>
  page.getByRole('menuitemradio', { name: new RegExp(`^${name}`) });

async function openThemeMenu(page: Page) {
  await themeTrigger(page).click();
  // Wait for the menu to be mounted (Radix renders into a portal on open).
  await expect(page.getByRole('menuitemradio').first()).toBeVisible();
}

test.describe('Theme', () => {
  test('exposes a labelled dropdown with three radio options', async ({ page }) => {
    await page.goto('/');

    const trigger = themeTrigger(page);
    // Default setting is "System"; it resolves to light in Playwright's default env.
    await expect(trigger).toHaveAttribute('aria-label', 'Theme: System');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await openThemeMenu(page);

    const options = page.getByRole('menuitemradio');
    await expect(options).toHaveCount(3);
    await expect(themeOption(page, 'Light')).toHaveAttribute('aria-checked', 'false');
    await expect(themeOption(page, 'Dark')).toHaveAttribute('aria-checked', 'false');
    await expect(themeOption(page, 'System')).toHaveAttribute('aria-checked', 'true');
  });

  test('selecting Dark applies the dark theme and updates the trigger', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');

    await openThemeMenu(page);
    await themeOption(page, 'Dark').click();

    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(themeTrigger(page)).toHaveAttribute('aria-label', 'Theme: Dark');

    // The checked option reflects the new setting when reopened.
    await openThemeMenu(page);
    await expect(themeOption(page, 'Dark')).toHaveAttribute('aria-checked', 'true');
    await expect(themeOption(page, 'Light')).toHaveAttribute('aria-checked', 'false');
    await expect(themeOption(page, 'System')).toHaveAttribute('aria-checked', 'false');
  });

  test('selecting Light applies the light theme and updates the trigger', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');

    // Move to dark first so selecting Light is an observable change.
    await openThemeMenu(page);
    await themeOption(page, 'Dark').click();
    await expect(html).toHaveAttribute('data-theme', 'dark');

    await openThemeMenu(page);
    await themeOption(page, 'Light').click();

    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(themeTrigger(page)).toHaveAttribute('aria-label', 'Theme: Light');
  });

  test('System follows the OS preference (resolves to dark when OS is dark)', async ({ page }) => {
    // Force the OS-level preference to dark for this page.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    const html = page.locator('html');

    // Default setting is System; with a dark OS preference it resolves to dark.
    await expect(themeTrigger(page)).toHaveAttribute('aria-label', 'Theme: System');
    await expect(html).toHaveAttribute('data-theme', 'dark');

    // Explicit Light overrides the OS preference...
    await openThemeMenu(page);
    await themeOption(page, 'Light').click();
    await expect(html).toHaveAttribute('data-theme', 'light');

    // ...and switching back to System re-resolves to the dark OS preference.
    await openThemeMenu(page);
    await themeOption(page, 'System').click();
    await expect(themeTrigger(page)).toHaveAttribute('aria-label', 'Theme: System');
    await expect(html).toHaveAttribute('data-theme', 'dark');
  });

  test('persists the chosen theme across reloads', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');

    await openThemeMenu(page);
    await themeOption(page, 'Dark').click();
    await expect(html).toHaveAttribute('data-theme', 'dark');

    await page.reload();

    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(themeTrigger(page)).toHaveAttribute('aria-label', 'Theme: Dark');
  });

  test('is operable with the keyboard (open, arrow, select)', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');

    const trigger = themeTrigger(page);
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitemradio').first()).toBeVisible();

    // Arrow down until the Dark option holds roving focus, then activate it.
    // Polling on the focused option keeps this deterministic regardless of which
    // item Radix focuses when the menu opens.
    const dark = themeOption(page, 'Dark');
    for (let i = 0; i < 4; i++) {
      if (await dark.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press('ArrowDown');
    }
    await expect(dark).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(trigger).toHaveAttribute('aria-label', 'Theme: Dark');
  });
});
