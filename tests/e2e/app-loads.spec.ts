import { test, expect } from '@playwright/test';

test.describe('Application Shell', () => {
  test('should load the application and display heading', async ({ page }) => {
    await page.goto('/');

    // Verify the heading is visible
    await expect(page.getByRole('heading', { name: /cpap analyzer/i })).toBeVisible();
  });

  test('should have correct page title', async ({ page }) => {
    await page.goto('/');

    // Verify the page title
    await expect(page).toHaveTitle(/cpap analyzer/i);
  });
});
