import { test, expect } from '@playwright/test';

test.describe('Data Management View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/data');
  });

  test('should render the Data Management heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /data management/i })).toBeVisible();
  });

  test('should render tab navigation with all four tabs', async ({ page }) => {
    const tabList = page.getByRole('tablist');
    await expect(tabList).toBeVisible();

    await expect(tabList.getByRole('tab', { name: /overview/i })).toBeVisible();
    await expect(tabList.getByRole('tab', { name: /import history/i })).toBeVisible();
    await expect(tabList.getByRole('tab', { name: /cleanup/i })).toBeVisible();
    await expect(tabList.getByRole('tab', { name: /backup & restore/i })).toBeVisible();
  });

  test('should switch tabs when clicked', async ({ page }) => {
    const tabList = page.getByRole('tablist');

    // Overview tab is active by default
    const overviewTab = tabList.getByRole('tab', { name: /overview/i });
    await expect(overviewTab).toHaveAttribute('data-state', 'active');

    // Click Import History tab
    const historyTab = tabList.getByRole('tab', { name: /import history/i });
    await historyTab.click();
    await expect(historyTab).toHaveAttribute('data-state', 'active');
    await expect(overviewTab).not.toHaveAttribute('data-state', 'active');
  });

  test('Overview tab should show storage usage information', async ({ page }) => {
    // Overview tab is default — wait for storage info to load
    await expect(page.getByText(/storage overview/i)).toBeVisible();
    await expect(page.getByText(/total used/i)).toBeVisible();
    await expect(page.getByText(/available/i).first()).toBeVisible();
    // Scope the "Sessions" storage-card label to the Storage Overview section.
    // Since the Phase 1 chrome redesign wrapped the sidebar nav label text in a
    // span, an unscoped exact "Sessions" now also matches the nav item.
    // The Overview tabpanel (aria-label="Overview") contains the storage cards
    // (Total Used / Available / Sessions / Imports) but not the sidebar nav.
    await expect(page.getByLabel('Overview').getByText('Sessions', { exact: true })).toBeVisible();
  });

  test('Overview tab should have an Import Data button', async ({ page }) => {
    const importButton = page.getByRole('button', { name: /import data/i });
    await expect(importButton).toBeVisible();
  });

  test('Import History tab should show empty state when no imports exist', async ({ page }) => {
    await page.getByRole('tab', { name: /import history/i }).click();

    await expect(page.getByText(/no import history/i)).toBeVisible();
  });

  test('Cleanup tab should show date range inputs and delete buttons', async ({ page }) => {
    await page.getByRole('tab', { name: /cleanup/i }).click();

    // Date range inputs for deletion
    await expect(page.getByLabel(/start date for deletion/i)).toBeVisible();
    await expect(page.getByLabel(/end date for deletion/i)).toBeVisible();

    // Delete Range button (disabled without valid dates)
    await expect(page.getByRole('button', { name: /delete range/i })).toBeVisible();

    // Delete All Data (danger zone)
    await expect(page.getByRole('button', { name: /delete all data/i })).toBeVisible();
  });

  test('Delete All Data should open a confirm dialog with type-DELETE pattern', async ({
    page,
  }) => {
    await page.getByRole('tab', { name: /cleanup/i }).click();

    await page.getByRole('button', { name: /delete all data/i }).click();

    // Dialog should appear
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/type.*delete.*to confirm/i)).toBeVisible();

    // Delete Everything button should be disabled without confirmation text
    const deleteButton = dialog.getByRole('button', { name: /delete everything/i });
    await expect(deleteButton).toBeDisabled();

    // Type DELETE to enable the button
    await dialog.getByLabel(/type delete to confirm/i).fill('DELETE');
    await expect(deleteButton).toBeEnabled();

    // Cancel instead of deleting
    await dialog.getByRole('button', { name: /cancel/i }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('Backup & Restore tab should show backup and restore sections', async ({ page }) => {
    await page.getByRole('tab', { name: /backup & restore/i }).click();

    // Create backup section
    await expect(page.getByText(/create encrypted backup/i)).toBeVisible();
    await expect(page.getByLabel(/encryption password/i)).toBeVisible();
    const backupButton = page.getByRole('button', { name: /create backup/i });
    await expect(backupButton).toBeVisible();
    await expect(backupButton).toBeDisabled(); // disabled without password

    // Restore section
    await expect(page.getByText(/restore from backup/i)).toBeVisible();
    await expect(page.getByLabel(/decryption password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /restore backup/i })).toBeVisible();
  });

  test('should have an Import Wizard button that opens the import modal', async ({ page }) => {
    // Since the command-surface refresh the wizard is a header-launched modal:
    // the Data-page buttons OPEN it (set the ephemeral flag) rather than
    // navigating. The full-page `/data/import` route is retained separately for
    // deep-links + the import-flow specs.
    const importWizardButton = page.getByRole('button', { name: /import wizard/i });
    await expect(importWizardButton).toBeVisible();

    await importWizardButton.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: /import data/i })).toBeVisible();
    // Opening the modal does NOT navigate — the user stays on the /data route.
    // (The shell's global WindowToggle now mirrors the date range to ?start/&end
    // on every page, so match the /data pathname rather than end-of-string.)
    await expect(page).toHaveURL(/\/data(\?|$)/);
  });
});
