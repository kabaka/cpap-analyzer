import { test, expect } from '@playwright/test';

test.describe('Settings View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
  });

  test('should render the Settings heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /^settings$/i })).toBeVisible();
  });

  test('should render tab navigation with all five tabs', async ({ page }) => {
    const tabList = page.getByRole('tablist');
    await expect(tabList).toBeVisible();

    await expect(tabList.getByRole('tab', { name: /general/i })).toBeVisible();
    await expect(tabList.getByRole('tab', { name: /analysis/i })).toBeVisible();
    await expect(tabList.getByRole('tab', { name: /integrations/i })).toBeVisible();
    await expect(tabList.getByRole('tab', { name: /privacy/i })).toBeVisible();
    await expect(tabList.getByRole('tab', { name: /about/i })).toBeVisible();
  });

  test('should switch tabs when clicked', async ({ page }) => {
    const tabList = page.getByRole('tablist');

    // General tab is active by default
    const generalTab = tabList.getByRole('tab', { name: /general/i });
    await expect(generalTab).toHaveAttribute('data-state', 'active');

    // Click Analysis tab
    const analysisTab = tabList.getByRole('tab', { name: /analysis/i });
    await analysisTab.click();
    await expect(analysisTab).toHaveAttribute('data-state', 'active');
    await expect(generalTab).not.toHaveAttribute('data-state', 'active');
  });

  test('General tab should show theme and date format selectors', async ({ page }) => {
    // General tab is default — appearance and date/time sections visible
    await expect(page.getByText(/appearance/i)).toBeVisible();
    await expect(page.getByText(/date & time/i)).toBeVisible();

    // Theme selector trigger
    await expect(page.getByText(/^theme$/i)).toBeVisible();

    // Date format selector
    await expect(page.getByText(/^date format$/i)).toBeVisible();
  });

  test('Analysis tab should show AHI thresholds and clustering method', async ({ page }) => {
    await page.getByRole('tab', { name: /analysis/i }).click();

    // AHI thresholds
    await expect(page.getByText(/ahi thresholds/i)).toBeVisible();
    await expect(page.getByLabel(/mild threshold/i)).toBeVisible();
    await expect(page.getByLabel(/moderate threshold/i)).toBeVisible();
    await expect(page.getByLabel(/severe threshold/i)).toBeVisible();

    // Clustering method
    await expect(page.getByText(/^clustering$/i)).toBeVisible();
    await expect(page.getByText(/clustering method/i)).toBeVisible();
  });

  test('Integrations tab should show accordion sections for Fitbit, Weather, and LLM', async ({
    page,
  }) => {
    await page.getByRole('tab', { name: /integrations/i }).click();

    await expect(page.getByText(/fitbit/i)).toBeVisible();
    await expect(page.getByText(/weather/i)).toBeVisible();
    await expect(page.getByText(/llm assistant/i)).toBeVisible();
  });

  test('Privacy tab should show storage info and Clear All Data button', async ({ page }) => {
    await page.getByRole('tab', { name: /privacy/i }).click();

    // Storage usage section
    await expect(page.getByText(/storage usage/i)).toBeVisible();

    // Privacy notice
    await expect(page.getByText(/your data stays on your device/i)).toBeVisible();

    // Clear All Data button in the danger zone
    await expect(page.getByRole('button', { name: /clear all data/i })).toBeVisible();
  });

  test('Clear All Data should open a confirmation dialog', async ({ page }) => {
    await page.getByRole('tab', { name: /privacy/i }).click();

    await page.getByRole('button', { name: /clear all data/i }).click();

    // Dialog should appear
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/clear all data/i)).toBeVisible();

    // Cancel button should close the dialog
    await dialog.getByRole('button', { name: /cancel/i }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('About tab should show application name and license info', async ({ page }) => {
    await page.getByRole('tab', { name: /about/i }).click();

    const aboutPanel = page.getByLabel('About');
    await expect(aboutPanel.getByText('CPAP Analyzer')).toBeVisible();
    await expect(aboutPanel.getByText('MIT')).toBeVisible();
    await expect(aboutPanel.getByText(/client-side only/i)).toBeVisible();
    await expect(aboutPanel.getByText(/zero telemetry/i)).toBeVisible();
  });

  test('Reset to Defaults button should open a confirmation dialog', async ({ page }) => {
    const resetButton = page.getByRole('button', { name: /reset to defaults/i });
    await expect(resetButton).toBeVisible();

    await resetButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/reset settings/i)).toBeVisible();

    // Cancel the dialog
    await dialog.getByRole('button', { name: /cancel/i }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('should change theme via the Settings theme selector', async ({ page }) => {
    // The General tab should be active by default with the theme selector.
    // The Radix Select uses a combobox role. Click to open dropdown, then pick 'Dark'.
    const themeTrigger = page.getByRole('combobox', { name: /theme/i });
    await expect(themeTrigger).toBeVisible();

    await themeTrigger.click();
    await page.getByRole('option', { name: /dark/i }).click();

    // Verify the html element's data-theme changed
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});
