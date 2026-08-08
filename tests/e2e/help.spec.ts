import { test, expect } from '@playwright/test';

test.describe('Help System', () => {
  test('should render the Help heading and subtitle', async ({ page }) => {
    await page.goto('/help');

    await expect(page.getByRole('heading', { name: /help & documentation/i })).toBeVisible();
    await expect(page.getByText(/guides, glossary/i)).toBeVisible();
  });

  test('should have a search input for help topics', async ({ page }) => {
    await page.goto('/help');

    const searchInput = page.getByLabel(/search help topics/i);
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toHaveAttribute('type', 'search');
  });

  test('should display topic cards for help articles', async ({ page }) => {
    await page.goto('/help');

    // The featured article "Getting Started" should be visible
    await expect(page.getByText(/getting started/i).first()).toBeVisible();

    // Topic grid should have multiple topic cards
    await expect(page.getByText(/all topics/i)).toBeVisible();
  });

  test('should filter topics when searching', async ({ page }) => {
    await page.goto('/help');

    const searchInput = page.getByLabel(/search help topics/i);
    await searchInput.fill('dashboard');

    // Should show "Search results" instead of "All topics"
    await expect(page.getByText(/search results/i)).toBeVisible();

    // Dashboard article should still be visible
    await expect(page.getByText(/dashboard/i).first()).toBeVisible();
  });

  test('should show no results message for non-matching search', async ({ page }) => {
    await page.goto('/help');

    const searchInput = page.getByLabel(/search help topics/i);
    await searchInput.fill('xyznonexistentterm');

    await expect(page.getByText(/no topics match/i)).toBeVisible();
  });

  test('should navigate to an article when clicking a topic card', async ({ page }) => {
    await page.goto('/help');

    // Click the featured "Getting Started" article
    const gettingStarted = page.getByRole('link', { name: /getting started/i }).first();
    await gettingStarted.click();

    // `history.pushState` (and thus the URL) updates synchronously on
    // navigate(), so this assertion is safe immediately after the click.
    await expect(page).toHaveURL(/\/help\/getting-started/);

    // The DOM swap is NOT synchronous with the URL change, though: react-router
    // 7's `RouterProvider` unconditionally wraps the location-state update
    // that feeds routing in `React.startTransition`, and `HelpArticle` is
    // `React.lazy()`-loaded, so React deliberately keeps the old `HelpHome`
    // tree mounted until the new one is ready ("no fallback flash" is
    // intentional v7 behavior). Asserting a bare
    // `getByRole('heading', { name: /getting started/i })` right after the
    // URL check can transiently match TWO headings at once — the old
    // `HelpHome` featured-article `<h2>` ("Getting Started") and, once it
    // resolves, `HelpArticle`'s own `<h1>` — which is a strict-mode
    // violation / flaky wait target under Playwright's tight CDP polling.
    //
    // Wait for HelpHome-specific content to detach first (its own "All
    // topics" section heading, which only HelpHome renders), THEN assert
    // scoped to `HelpArticle`'s `<article>` landmark — unambiguous even
    // during the brief window both trees are momentarily present, since
    // HelpHome never renders an `article` role.
    await expect(page.getByRole('heading', { name: /all topics|search results/i })).toBeHidden();

    const article = page.getByRole('article');
    await expect(
      article.getByRole('heading', { level: 1, name: /getting started/i }),
    ).toBeVisible();
  });

  test('should render a help article via direct URL', async ({ page }) => {
    await page.goto('/help/getting-started');

    await expect(page.getByRole('heading', { name: /getting started/i })).toBeVisible();

    // Article sections should render
    await expect(page.getByRole('heading', { name: /what is cpap analyzer/i })).toBeVisible();
  });

  test('should show breadcrumb navigation on article pages', async ({ page }) => {
    await page.goto('/help/getting-started');

    const breadcrumb = page.getByRole('navigation', { name: /breadcrumb/i });
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb.getByText(/help/i)).toBeVisible();
    await expect(breadcrumb.getByText(/getting started/i)).toBeVisible();
  });

  test('should render the glossary page', async ({ page }) => {
    await page.goto('/help/glossary');

    // Glossary search input
    await expect(page.getByLabel(/search glossary terms/i)).toBeVisible();

    // Depth radiogroup
    await expect(page.getByRole('radiogroup', { name: /explanation depth/i })).toBeVisible();

    // Category filter
    await expect(page.getByLabel(/category/i)).toBeVisible();
  });

  test('should show previous/next navigation between articles', async ({ page }) => {
    await page.goto('/help/getting-started');

    // "Getting Started" is the first article, so it should have a "next" button but no "previous"
    const articleNav = page.getByRole('navigation', { name: /article navigation/i });
    await expect(articleNav).toBeVisible();

    // Should have a next article button (Importing Data is the second article)
    const nextButton = articleNav.getByRole('button', { name: /importing data/i });
    await expect(nextButton).toBeVisible();

    // Click next to navigate
    await nextButton.click();
    await expect(page).toHaveURL(/\/help\/importing-data/);
    await expect(page.getByRole('heading', { name: /importing data/i })).toBeVisible();
  });

  test('should navigate to glossary via quick link on help home', async ({ page }) => {
    await page.goto('/help');

    const glossaryLink = page.getByRole('button', { name: /glossary/i });
    await expect(glossaryLink).toBeVisible();

    await glossaryLink.click();
    await expect(page).toHaveURL(/\/help\/glossary/);
  });
});
