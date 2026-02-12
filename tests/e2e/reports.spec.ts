import { test, expect } from '@playwright/test';

test.describe('Reports View', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/reports');
  });

  test('should render the Reports heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /^reports$/i })).toBeVisible();
  });

  test('should render three report template cards', async ({ page }) => {
    const radioGroup = page.getByRole('radiogroup', { name: /report templates/i });
    await expect(radioGroup).toBeVisible();

    const templateCards = radioGroup.getByRole('radio');
    await expect(templateCards).toHaveCount(3);

    // Verify the three template names are present
    await expect(page.getByRole('heading', { name: /physician summary/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /full analysis/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /custom report/i })).toBeVisible();
  });

  test('should select a template card on click and show aria-checked', async ({ page }) => {
    const radioGroup = page.getByRole('radiogroup', { name: /report templates/i });

    // Physician Summary is selected by default
    const physicianCard = radioGroup.getByRole('radio').filter({ hasText: /physician summary/i });
    await expect(physicianCard).toHaveAttribute('aria-checked', 'true');

    // Click Full Analysis
    const fullAnalysisCard = radioGroup.getByRole('radio').filter({ hasText: /full analysis/i });
    await fullAnalysisCard.click();
    await expect(fullAnalysisCard).toHaveAttribute('aria-checked', 'true');
    await expect(physicianCard).toHaveAttribute('aria-checked', 'false');
  });

  test('should show section checkboxes when Custom Report template is selected', async ({
    page,
  }) => {
    // Select the Custom Report template
    const radioGroup = page.getByRole('radiogroup', { name: /report templates/i });
    const customCard = radioGroup.getByRole('radio').filter({ hasText: /custom report/i });
    await customCard.click();
    await expect(customCard).toHaveAttribute('aria-checked', 'true');

    // Section checkboxes should now be visible
    await expect(page.getByRole('heading', { name: /report sections/i })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /summary statistics/i })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /session details/i })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /ahi trend/i })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /leak analysis/i })).toBeVisible();
  });

  test('should not show section checkboxes for non-custom templates', async ({ page }) => {
    // Physician Summary is selected by default — no section checkboxes
    await expect(page.getByRole('heading', { name: /report sections/i })).not.toBeVisible();
  });

  test('should render PDF and CSV download buttons', async ({ page }) => {
    const pdfButton = page.getByRole('button', { name: /download pdf report/i });
    const csvButton = page.getByRole('button', { name: /export csv data/i });

    await expect(pdfButton).toBeVisible();
    await expect(pdfButton).toBeEnabled();
    await expect(csvButton).toBeVisible();
    await expect(csvButton).toBeEnabled();
  });

  test('should render encrypted export section with password input', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /encrypted export/i })).toBeVisible();

    const passwordInput = page.getByLabel(/^password$/i);
    await expect(passwordInput).toBeVisible();
    await expect(passwordInput).toHaveAttribute('type', 'password');

    const encryptButton = page.getByRole('button', { name: /download encrypted archive/i });
    await expect(encryptButton).toBeVisible();
  });

  test('should show date range inputs', async ({ page }) => {
    await expect(page.getByLabel(/start date/i)).toBeVisible();
    await expect(page.getByLabel(/end date/i)).toBeVisible();
  });

  test('should toggle section checkboxes in custom template', async ({ page }) => {
    // Select Custom Report
    const radioGroup = page.getByRole('radiogroup', { name: /report templates/i });
    await radioGroup
      .getByRole('radio')
      .filter({ hasText: /custom report/i })
      .click();

    const summaryCheckbox = page.getByRole('checkbox', { name: /summary statistics/i });
    await expect(summaryCheckbox).toBeVisible();

    // Get initial state and toggle
    const wasChecked = await summaryCheckbox.isChecked();
    await summaryCheckbox.click();
    if (wasChecked) {
      await expect(summaryCheckbox).not.toBeChecked();
    } else {
      await expect(summaryCheckbox).toBeChecked();
    }
  });
});
