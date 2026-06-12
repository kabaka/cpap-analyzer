import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('should navigate to all top-level routes via sidebar', async ({ page }) => {
    await page.goto('/');

    const nav = page.getByRole('navigation');

    // With empty DB, Dashboard renders EmptyState with "CPAP Analyzer" heading
    await expect(page.getByRole('heading', { name: /cpap analyzer/i })).toBeVisible();

    // Navigate to Sessions
    await nav.getByRole('link', { name: /sessions/i }).click();
    await expect(page.getByRole('heading', { name: /^sessions$/i })).toBeVisible();

    // Navigate to Explore
    await nav.getByRole('link', { name: /explore/i }).click();
    await expect(page.getByRole('heading', { name: /^explore$/i })).toBeVisible();

    // Navigate to Reports
    await nav.getByRole('link', { name: /reports/i }).click();
    await expect(page.getByRole('heading', { name: /^reports$/i })).toBeVisible();

    // Navigate to Data Management
    await nav.getByRole('link', { name: /data/i }).click();
    await expect(page.getByRole('heading', { name: /data management/i })).toBeVisible();

    // Navigate to Settings
    await nav.getByRole('link', { name: /settings/i }).click();
    await expect(page.getByRole('heading', { name: /^settings$/i })).toBeVisible();

    // Navigate to Help
    await nav.getByRole('link', { name: /help/i }).click();
    await expect(page.getByRole('heading', { name: /help/i })).toBeVisible();
  });

  test('should highlight active navigation link', async ({ page }) => {
    await page.goto('/sessions');

    // React Router NavLink sets aria-current="page" on the active link
    const nav = page.getByRole('navigation');
    const sessionsLink = nav.getByRole('link', { name: /sessions/i });
    await expect(sessionsLink).toHaveAttribute('aria-current', 'page');

    // Dashboard link should NOT be active
    const dashboardLink = nav.getByRole('link', { name: /dashboard/i });
    await expect(dashboardLink).not.toHaveAttribute('aria-current', 'page');
  });

  test('should navigate via direct URL to nested route', async ({ page }) => {
    await page.goto('/explore/correlations');
    await expect(page.getByRole('heading', { name: /statistical analysis/i })).toBeVisible();
  });

  test('should navigate via direct URL to all top-level routes', async ({ page }) => {
    // Test that each route loads directly without needing sidebar navigation
    const routes = [
      { path: '/', heading: /cpap analyzer/i },
      { path: '/sessions', heading: /^sessions$/i },
      { path: '/explore', heading: /^explore$/i },
      { path: '/reports', heading: /^reports$/i },
      { path: '/data', heading: /data management/i },
      { path: '/settings', heading: /^settings$/i },
      { path: '/help', heading: /help/i },
    ];

    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.getByRole('heading', { name: route.heading })).toBeVisible();
    }
  });
});
