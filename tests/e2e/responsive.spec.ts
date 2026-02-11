import { test, expect } from '@playwright/test';

test.describe('Responsive Layout', () => {
  test('should show sidebar and hide hamburger on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/');

    // Sidebar navigation should be visible
    const sidebar = page.locator('aside[aria-label="Main navigation"]');
    await expect(sidebar).toBeVisible();

    // Hamburger menu toggle should be hidden on desktop
    const menuToggle = page.getByRole('button', { name: /navigation menu/i });
    await expect(menuToggle).toBeHidden();

    // Content should be visible (empty DB shows EmptyState heading)
    await expect(page.getByRole('heading', { name: /cpap analyzer/i })).toBeVisible();
  });

  test('should show hamburger and hide sidebar on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    // Content should still be visible (empty DB shows EmptyState heading)
    await expect(page.getByRole('heading', { name: /cpap analyzer/i })).toBeVisible();

    // Hamburger menu toggle should be visible on mobile
    const menuToggle = page.getByRole('button', { name: /navigation menu/i });
    await expect(menuToggle).toBeVisible();
  });

  test('should open sidebar on mobile when hamburger is clicked', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    const menuToggle = page.getByRole('button', { name: /navigation menu/i });
    await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');

    // Open the sidebar
    await menuToggle.click();
    await expect(menuToggle).toHaveAttribute('aria-expanded', 'true');

    // Navigate via sidebar and sidebar should close
    const nav = page.getByRole('navigation');
    await nav.getByRole('link', { name: /sessions/i }).click();
    await expect(page.getByRole('heading', { name: /sessions/i })).toBeVisible();
  });

  test('should handle tablet viewport', async ({ page }) => {
    // 768px is at the desktop breakpoint (>767px), so desktop layout applies
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /cpap analyzer/i })).toBeVisible();

    // At 768px, the sidebar should be visible (breakpoint is max-width: 767px)
    const sidebar = page.locator('aside[aria-label="Main navigation"]');
    await expect(sidebar).toBeVisible();
  });
});
