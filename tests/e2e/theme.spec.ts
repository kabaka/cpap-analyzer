import { test, expect } from '@playwright/test';

test.describe('Theme', () => {
  test('should cycle through themes when clicking the toggle', async ({ page }) => {
    await page.goto('/');

    const html = page.locator('html');
    const themeToggle = page.getByRole('button', { name: /switch theme/i });

    // Initial state: theme is 'system', resolves to 'light' in Playwright
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(themeToggle).toHaveAttribute('aria-label', 'Switch theme (current: system)');

    // Click 1: system → light (data-theme stays 'light')
    await themeToggle.click();
    await expect(themeToggle).toHaveAttribute('aria-label', 'Switch theme (current: light)');
    await expect(html).toHaveAttribute('data-theme', 'light');

    // Click 2: light → dark
    await themeToggle.click();
    await expect(themeToggle).toHaveAttribute('aria-label', 'Switch theme (current: dark)');
    await expect(html).toHaveAttribute('data-theme', 'dark');

    // Click 3: dark → system (resolves to 'light' in Playwright)
    await themeToggle.click();
    await expect(themeToggle).toHaveAttribute('aria-label', 'Switch theme (current: system)');
    await expect(html).toHaveAttribute('data-theme', 'light');
  });

  test('should persist theme preference across page reloads', async ({ page }) => {
    await page.goto('/');

    const html = page.locator('html');
    const themeToggle = page.getByRole('button', { name: /switch theme/i });

    // Click twice to set theme to 'dark' (system → light → dark)
    await themeToggle.click();
    await themeToggle.click();
    await expect(html).toHaveAttribute('data-theme', 'dark');

    // Reload the page
    await page.reload();

    // Theme should persist as 'dark'
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('button', { name: /switch theme/i })).toHaveAttribute(
      'aria-label',
      'Switch theme (current: dark)',
    );
  });
});
