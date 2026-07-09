import { test, expect, type Page } from '@playwright/test';

/**
 * Header-launched Import wizard MODAL (command-surface refresh).
 *
 * Since the refresh the header "Import therapy data" button opens the wizard as
 * an app-level modal dialog (a sibling of the ⌘K palette and the import dock)
 * rather than navigating to the `/data/import` route. The route is retained for
 * deep-links + the import-flow specs; this spec locks the MODAL affordance:
 *
 *  - the header button opens a role="dialog" wizard WITHOUT navigating,
 *  - the select step offers the two import sources,
 *  - Esc and a backdrop click both close it non-destructively (no navigation)
 *    and Esc restores focus to the invoking button (WCAG 2.4.3).
 *
 * These are behavioural (roles, URL, focus) so they tolerate visual tweaks.
 */

const importButton = (page: Page) => page.getByRole('button', { name: 'Import therapy data' });

test.describe('Import wizard modal (header-launched)', () => {
  test('the header Import button opens the wizard dialog and shows the two sources', async ({
    page,
  }) => {
    // Start on a non-Data route so we can prove the modal does not navigate.
    await page.goto('/sessions');
    await expect(page.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();

    await importButton(page).click();

    // The wizard opens as a modal dialog with the "Import data" heading.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: /import data/i })).toBeVisible();

    // Opening the modal is an overlay, NOT a route change — still on /sessions.
    await expect(page).toHaveURL(/\/sessions(\?|$)/);

    // The select step offers both import sources.
    await expect(dialog.getByRole('button', { name: 'Import from CPAP SD card' })).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'Import from Google Health (Fitbit)' }),
    ).toBeVisible();
  });

  test('Escape closes the modal non-destructively and restores focus to the Import button', async ({
    page,
  }) => {
    await page.goto('/sessions');
    await expect(page.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();

    // Focus the invoker first so focus-restoration is deterministic across
    // browsers (WebKit does not focus a <button> on click).
    const btn = importButton(page);
    await btn.focus();
    await btn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');

    // Closed, still on /sessions (Esc "continues in background" — no navigation,
    // nothing destroyed), and focus is returned to the invoking button.
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/sessions(\?|$)/);
    await expect(btn).toBeFocused();
  });

  test('clicking the backdrop closes the modal without navigating', async ({ page }) => {
    await page.goto('/sessions');
    await expect(page.getByRole('heading', { name: 'Sessions', exact: true })).toBeVisible();

    await importButton(page).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Click the overlay to the RIGHT of the centered 720px panel (clear of both
    // the panel — which stops propagation — and the left-hand sidebar).
    const vp = page.viewportSize();
    expect(vp).not.toBeNull();
    if (vp) await page.mouse.click(vp.width - 5, Math.round(vp.height / 2));

    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/sessions(\?|$)/);
  });
});
