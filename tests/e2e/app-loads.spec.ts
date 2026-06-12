import { test, expect } from '@playwright/test';

test.describe('Application Shell', () => {
  test('should load the application and display the landing page', async ({ page }) => {
    await page.goto('/');

    // With empty DB, the Dashboard renders EmptyState with "CPAP Analyzer" heading
    await expect(page.getByRole('heading', { name: /cpap analyzer/i })).toBeVisible();

    // Verify the app name appears in the sidebar
    const sidebar = page.getByRole('complementary', { name: /main navigation/i });
    await expect(sidebar.getByText('CPAP Analyzer')).toBeVisible();
  });

  test('should have correct page title', async ({ page }) => {
    await page.goto('/');

    // Verify the page title
    await expect(page).toHaveTitle(/cpap analyzer/i);
  });

  test('should render the sidebar navigation with all links', async ({ page }) => {
    await page.goto('/');

    const nav = page.getByRole('navigation');
    await expect(nav.getByRole('link', { name: /dashboard/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /sessions/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /explore/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /reports/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /data/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /settings/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /help/i })).toBeVisible();
  });
});
