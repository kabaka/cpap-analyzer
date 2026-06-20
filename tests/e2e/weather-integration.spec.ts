import { test, expect, type Page } from '@playwright/test';
import {
  OPEN_METEO_GLOBS,
  assertEgressPrivacy,
  daysAgoStr,
  installOpenMeteoMocks,
  seedSessions,
  seedWeatherSettings,
} from './_support/weather';

/**
 * End-to-end coverage for the Weather & Environmental Data integration
 * (design refs: docs/design/weather-integration{,-visual-spec}.md).
 *
 * PRIVACY CONTRACT FOR THIS SUITE: every test installs `installOpenMeteoMocks`
 * BEFORE the first `goto`. That helper registers a broad network GUARD first
 * (aborts any un-mocked Open-Meteo request) and then route-fulfilment for ALL
 * FOUR Open-Meteo hosts. No test is permitted to reach the real network. The
 * "configure + sync" test additionally asserts on the intercepted request URLs
 * (≤2-dp coordinates, no identifier params).
 *
 * Coverage map (task flows 1–6):
 *  1. Consent gate            → describe('Consent gate')
 *  2. Configure + sync        → describe('Configure and sync (mocked)')
 *  3. No-provider-data        → describe('No provider data')
 *  4. Geolocation denied      → describe('Geolocation denied')
 *  5. Dashboard panel         → describe('Dashboard WeatherOverview panel')
 *  6. Correlation availability→ describe('Cross-Source correlation availability')
 */

// A synced night routes to the ARCHIVE host (≥ ARCHIVE_LAG_DAYS=5 days old) and
// crosses midnight, so it touches two civil dates and exercises the merge path.
const NIGHT_DATE = daysAgoStr(8);

/** Open Settings → Integrations and expand the Weather accordion. */
async function openWeatherAccordion(page: Page): Promise<void> {
  await page.getByRole('tab', { name: /integrations/i }).click();
  const trigger = page.getByRole('button', { name: /Weather & Air Quality/i });
  await expect(trigger).toBeVisible();
  // Expand only if collapsed (Radix sets aria-expanded).
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click();
  }
  await expect(page.getByText('Enable Weather & Air Quality')).toBeVisible();
}

/** The Radix Switch governing the weather integration. */
function weatherSwitch(page: Page) {
  // The only switch inside the expanded weather panel.
  return page.getByRole('switch').first();
}

test.describe('Weather integration — consent gate', () => {
  test.beforeEach(async ({ page }) => {
    await installOpenMeteoMocks(page);
    await page.goto('/settings');
    await openWeatherAccordion(page);
  });

  test('toggling on opens the consent dialog WITHOUT enabling; the disclosure is present', async ({
    page,
  }) => {
    await weatherSwitch(page).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Enable Weather & Air Quality')).toBeVisible();

    // "What leaves / what never leaves your device" disclosure (privacy contract).
    await expect(dialog.getByText(/what leaves your device/i)).toBeVisible();
    await expect(dialog.getByText(/what never leaves your device/i)).toBeVisible();
    // Specific contract lines.
    await expect(dialog.getByText(/approximate location/i)).toBeVisible();
    await expect(dialog.getByText(/no account and no API key/i)).toBeVisible();
    await expect(dialog.getByText(/precise GPS/i)).toBeVisible();

    // The integration must NOT have been enabled merely by opening the dialog:
    // the config panel (location fieldset) is not shown.
    await expect(page.getByRole('group', { name: /location/i })).toHaveCount(0);
  });

  test('the acknowledgement checkbox gates the primary Enable button', async ({ page }) => {
    await weatherSwitch(page).click();
    const dialog = page.getByRole('dialog');

    const enableBtn = dialog.getByRole('button', { name: /^enable$/i });
    await expect(enableBtn).toBeDisabled();

    await dialog.getByRole('checkbox', { name: /I understand what is sent/i }).check();
    await expect(enableBtn).toBeEnabled();
  });

  test('Cancel reverts the toggle to off and persists nothing', async ({ page }) => {
    await weatherSwitch(page).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /cancel/i }).click();

    await expect(dialog).not.toBeVisible();
    // Switch reverted to off.
    await expect(weatherSwitch(page)).not.toBeChecked();
    // Accordion trigger still reports Disabled.
    await expect(
      page.getByRole('button', { name: /Weather & Air Quality — Disabled/i }),
    ).toBeVisible();
  });

  test('Esc cancels and reverts the toggle to off', async ({ page }) => {
    await weatherSwitch(page).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(weatherSwitch(page)).not.toBeChecked();
  });

  test('acknowledging and confirming sets the integration enabled', async ({ page }) => {
    await weatherSwitch(page).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: /I understand what is sent/i }).check();
    await dialog.getByRole('button', { name: /^enable$/i }).click();

    await expect(dialog).not.toBeVisible();
    // Switch is on; the config panel + "Connects online" pill appear.
    await expect(weatherSwitch(page)).toBeChecked();
    await expect(page.getByText('Connects online')).toBeVisible();
    await expect(page.getByRole('button', { name: /sync now/i })).toBeVisible();
  });
});

test.describe('Weather integration — configure and sync (mocked network)', () => {
  test('sets a manual location, syncs, shows Synced nights, and egress is privacy-safe', async ({
    page,
  }) => {
    const mock = await installOpenMeteoMocks(page);

    // Already consented + enabled (the consent flow is covered separately), and a
    // therapy night exists to sync.
    await seedWeatherSettings(page, { enabled: true });
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
    await seedSessions(page, [NIGHT_DATE]);

    await page.goto('/settings');
    await openWeatherAccordion(page);

    // Set a manual location. A GPS-precise input must be coarsened to ≤2 dp before
    // it ever leaves the device — we type 4-dp coordinates deliberately.
    const lat = page.getByLabel('Latitude');
    const lon = page.getByLabel('Longitude');
    await lat.fill('40.7128');
    await lon.fill('-74.0060');
    await lon.blur();

    // Sync now → scope step → start.
    await page.getByRole('button', { name: /sync now/i }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText(/sync weather data/i)).toBeVisible();
    // Scope step shows the egress reminder + night count BEFORE any request.
    await expect(sheet.getByText(/this sends/i)).toBeVisible();

    await sheet.getByRole('button', { name: /start sync/i }).click();

    // Progress → completion. The coverage view shows a Synced badge + count chip.
    await expect(sheet.getByRole('img', { name: /^Synced$/ })).toBeVisible({ timeout: 15_000 });
    await expect(sheet.getByText(/1 Synced/)).toBeVisible();
    // The synced row carries the night's date.
    await expect(sheet.getByText(NIGHT_DATE)).toBeVisible();

    await sheet.getByRole('button', { name: /done/i }).click();
    await expect(sheet).not.toBeVisible();

    // The panel status reports stored weather DAYS, not nights: a midnight-
    // spanning night stores a daily summary for two civil dates, so the stored
    // daily-summary count can exceed the night count. The label is therefore
    // honest ("N days of weather data") and never contradicts the coverage view
    // above, which asserted exactly ONE Synced night.
    await expect(page.getByText(/Last synced:.*\d+ days? of weather data/)).toBeVisible();

    // ── Egress assertions (the privacy heart of this suite) ──
    expect(mock.urls.length, 'at least one Open-Meteo request was intercepted').toBeGreaterThan(0);
    // Coordinates were rounded to 2 dp; no identifier params present.
    assertEgressPrivacy(mock.urls);
    // The 4-dp input must have left as the 2-dp rounded value.
    const coordUrl = mock.urls.find((u) => new URL(u).searchParams.has('latitude'));
    expect(coordUrl, 'a coordinate-bearing request URL exists').toBeTruthy();
    const params = new URL(coordUrl as string).searchParams;
    expect(params.get('latitude')).toBe('40.71');
    expect(params.get('longitude')).toBe('-74.01');
    // Routed to the archive host for an 8-day-old night.
    expect(mock.urls.some((u) => new URL(u).hostname === 'archive-api.open-meteo.com')).toBe(true);
  });
});

test.describe('Weather integration — no provider data', () => {
  test('a date the provider returns empty for shows "No data available", never a 0', async ({
    page,
  }) => {
    await installOpenMeteoMocks(page, { empty: true });

    await seedWeatherSettings(page, { enabled: true, latitude: 40.71, longitude: -74.01 });
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
    await seedSessions(page, [NIGHT_DATE]);

    await page.goto('/settings');
    await openWeatherAccordion(page);

    await page.getByRole('button', { name: /sync now/i }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: /start sync/i }).click();

    // The coverage view distinguishes queried-but-empty from not-fetched: the
    // "No data available" status (em dash), never a fabricated synced 0.
    await expect(sheet.getByRole('img', { name: /No data available/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(sheet.getByText(/No data available/i).first()).toBeVisible();
    // No "Synced" badge should be present for an empty response.
    await expect(sheet.getByRole('img', { name: /^Synced$/ })).toHaveCount(0);
  });
});

test.describe('Weather integration — geolocation denied', () => {
  test('denying geolocation shows the inline error and focus falls back to manual entry', async ({
    browser,
  }) => {
    // A context that DENIES geolocation. We never rely on real geolocation.
    const context = await browser.newContext({ permissions: [] });
    const page = await context.newPage();
    await installOpenMeteoMocks(page);

    // Make any getCurrentPosition call deterministically invoke the error callback
    // with PERMISSION_DENIED (code 1) so the test is independent of the browser's
    // permission prompt behaviour.
    await page.addInitScript(() => {
      const denied = { code: 1, message: 'User denied Geolocation' };
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition: (_success: PositionCallback, error?: PositionErrorCallback) => {
            if (error) error(denied as unknown as GeolocationPositionError);
          },
          watchPosition: () => 0,
          clearWatch: () => {},
        },
      });
    });

    await seedWeatherSettings(page, { enabled: true });
    await page.goto('/settings');
    await openWeatherAccordion(page);

    const useCurrent = page.getByRole('button', { name: /use current location/i });
    await expect(useCurrent).toBeVisible();
    await useCurrent.click();

    // Inline error (role="alert") appears...
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/permission was denied/i);
    await expect(alert).toContainText(/enter coordinates manually/i);

    // ...and focus moves to the manual latitude input.
    await expect(page.getByLabel('Latitude')).toBeFocused();

    await context.close();
  });
});

test.describe('Weather integration — Dashboard WeatherOverview panel', () => {
  test('absent when disabled', async ({ page }) => {
    await installOpenMeteoMocks(page);

    // Seed a session so the dashboard renders (not the empty state), but leave
    // weather disabled.
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
    await seedSessions(page, [NIGHT_DATE]);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // The WeatherOverview panel renders `null` when disabled.
    await expect(page.getByLabel(/weather and air quality overview/i)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Weather & Air Quality/ })).toHaveCount(0);
  });

  test('renders headline tiles (incl. an AQI category word) once enabled + synced', async ({
    page,
  }) => {
    await installOpenMeteoMocks(page, { usAqi: 78 });

    await seedWeatherSettings(page, { enabled: true, latitude: 40.71, longitude: -74.01 });
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
    await seedSessions(page, [NIGHT_DATE]);

    // Sync via the real UI (writes hourly weather + AQ to IndexedDB).
    await page.goto('/settings');
    await openWeatherAccordion(page);
    await page.getByRole('button', { name: /sync now/i }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: /start sync/i }).click();
    await expect(sheet.getByRole('img', { name: /^Synced$/ })).toBeVisible({ timeout: 15_000 });
    await sheet.getByRole('button', { name: /done/i }).click();

    // Now the dashboard panel should render with tiles.
    await page.goto('/');
    const panel = page.getByLabel(/weather and air quality overview/i);
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // Headline tiles by label.
    await expect(panel.getByText('Pressure', { exact: true })).toBeVisible();
    await expect(panel.getByText('Humidity', { exact: true })).toBeVisible();
    await expect(panel.getByText('Air Quality', { exact: true })).toBeVisible();

    // The AQI tile shows a CATEGORY WORD (not just colour). US AQI 78 → "Moderate".
    // The AqiSwatch exposes role="img" with an aria-label carrying the word.
    await expect(panel.getByRole('img', { name: /Air quality: Moderate/i })).toBeVisible();
  });
});

test.describe('Weather integration — Cross-Source correlation availability', () => {
  test('"Compare against" lacks a Weather group when no weather is synced', async ({ page }) => {
    await installOpenMeteoMocks(page);

    // CPAP data present, weather enabled but NOT synced.
    await seedWeatherSettings(page, { enabled: true, latitude: 40.71, longitude: -74.01 });
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
    await seedSessions(page, [daysAgoStr(8), daysAgoStr(9), daysAgoStr(10)]);

    await page.goto('/explore/correlations?tab=cross-source');
    await expect(page.getByRole('heading', { name: /cross-source analysis/i })).toBeVisible();

    // With CPAP-only data (no wearable, no synced weather), the cross-source view
    // lands in its "No Comparison Data Available" state — there is NO grouped
    // "Compare against" selector and therefore no Weather & Environment group.
    await expect(
      page.getByRole('heading', { name: /no comparison data available/i }),
    ).toBeVisible();
    await expect(page.getByRole('combobox', { name: /compare against/i })).toHaveCount(0);
  });

  test('"Compare against" contains a Weather & Environment group once weather is synced', async ({
    page,
  }) => {
    const mock = await installOpenMeteoMocks(page);

    await seedWeatherSettings(page, { enabled: true, latitude: 40.71, longitude: -74.01 });
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
    const dates = [daysAgoStr(8), daysAgoStr(9), daysAgoStr(10)];
    await seedSessions(page, dates);

    // Sync several nights so the correlation join has weather data.
    await page.goto('/settings');
    await openWeatherAccordion(page);
    await page.getByRole('button', { name: /sync now/i }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: /start sync/i }).click();
    await expect(sheet.getByText(/Synced/).first()).toBeVisible({ timeout: 20_000 });
    await sheet.getByRole('button', { name: /done/i }).click();

    // Network never escaped + privacy held.
    assertEgressPrivacy(mock.urls);

    await page.goto('/explore/correlations?tab=cross-source');
    await expect(page.getByRole('heading', { name: /cross-source analysis/i })).toBeVisible();

    // Open the grouped "Compare against" selector and assert a Weather group option.
    const selector = page.getByRole('combobox', { name: /compare against/i });
    await expect(selector).toBeVisible({ timeout: 15_000 });
    await selector.click();

    // A weather metric option (group "Weather & Environment") is present.
    await expect(
      page
        .getByRole('option', { name: /Barometric Pressure|Air Quality|Humidity|Dew Point/i })
        .first(),
    ).toBeVisible();
  });
});

// Belt-and-suspenders: confirm the Open-Meteo globs the suite mocks match the
// production host list (a guard against host drift silently un-mocking a call).
test.describe('Weather integration — mock host coverage', () => {
  test('all four Open-Meteo hosts are covered by the route globs', () => {
    expect(OPEN_METEO_GLOBS).toHaveLength(4);
    expect(OPEN_METEO_GLOBS.join(' ')).toContain('archive-api.open-meteo.com');
    expect(OPEN_METEO_GLOBS.join(' ')).toContain('api.open-meteo.com');
    expect(OPEN_METEO_GLOBS.join(' ')).toContain('air-quality-api.open-meteo.com');
    expect(OPEN_METEO_GLOBS.join(' ')).toContain('geocoding-api.open-meteo.com');
  });
});
