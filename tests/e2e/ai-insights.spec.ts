/**
 * AI Insights — E2E coverage for the opt-in "compute-then-narrate" feature.
 *
 * Real LLM inference is intentionally NOT exercised here: WebGPU is unreliable
 * headless, no API keys exist in CI, and (per Core Principle 1) nothing may
 * egress. Instead this suite covers everything that PRECEDES and GATES
 * generation — the settings panel, the two-gate cloud consent flow, the opt-in
 * visibility of the in-app trigger, the safe idle drawer state, the
 * needs-config / needs-consent recovery + deep-link, and the accessibility
 * smoke (radiogroup keyboard nav, drawer dismissal).
 *
 * The acceptance source of truth is `docs/design/ai-insights-ux.md` §9. Each
 * test notes the §9 item(s) it satisfies. A cloud-LLM network guard
 * ({@link installLLMNetworkGuard}) fails the test loudly if any request ever
 * reaches a real provider — proving §9.6 "no egress before consent".
 *
 * Selectors are role/name/label-based (not brittle CSS) and tolerant of styling
 * changes, per the e2e standards.
 */

import { test, expect, type Page } from '@playwright/test';

import {
  installLLMNetworkGuard,
  seedAiInsightsSettings,
  seedSessions,
  SEEDED_SESSION_ID,
} from './_support/aiInsights';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Open Settings → Integrations and expand the AI Insights accordion item. */
async function openAiInsightsPanel(page: Page): Promise<void> {
  await page.goto('/settings');
  await page.getByRole('tab', { name: /integrations/i }).click();
  // The accordion trigger is a button reading "AI Insights — …". Expand it.
  const trigger = page.getByRole('button', { name: /ai insights/i });
  await expect(trigger).toBeVisible();
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click();
  }
}

/**
 * The expanded AI Insights accordion content region. Radix renders the content
 * as `role="region"` labelled by its trigger, so its accessible name is the
 * trigger text ("AI Insights — …"). Scoping to it disambiguates the panel's
 * enable switch from the sibling Fitbit/Weather switches (which share the
 * label-less `switchRow` pattern, so `getByRole('switch')` alone is ambiguous).
 */
function aiInsightsRegion(page: Page) {
  return page.getByRole('region', { name: /ai insights/i });
}

/** The Gate-1 enable switch inside the AI Insights panel. */
function enableSwitch(page: Page) {
  return aiInsightsRegion(page).getByRole('switch');
}

/** The backend radiogroup (custom role="radiogroup", labelled "AI backend"). */
function backendGroup(page: Page) {
  return page.getByRole('radiogroup', { name: /ai backend/i });
}

/** A backend radio option by accessible name (the option label text). */
function backendOption(page: Page, name: RegExp) {
  return backendGroup(page).getByRole('radio', { name });
}

// ── 1. Settings panel: AI Insights item + enable reveals backend radiogroup ──

test.describe('AI Insights — Settings panel', () => {
  test.beforeEach(async ({ page }) => {
    await installLLMNetworkGuard(page);
  });

  test('Integrations tab shows an "AI Insights" item (de-stubbed from "LLM Assistant")', async ({
    page,
  }) => {
    await page.goto('/settings');
    await page.getByRole('tab', { name: /integrations/i }).click();

    // The new opt-in item is present and reads "Disabled" by default (UX §2.1).
    await expect(page.getByRole('button', { name: /ai insights/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /ai insights.*disabled/i })).toBeVisible();
    // The old stub label is gone.
    await expect(page.getByText(/llm assistant/i)).toHaveCount(0);
  });

  test('enabling reveals the backend radiogroup with a privacy-default on-device backend; no cloud auto-selected (§9.1, §9.5)', async ({
    page,
  }) => {
    await openAiInsightsPanel(page);

    // Before enabling, the radiogroup is absent (config hidden — UX §3.2).
    await expect(backendGroup(page)).toHaveCount(0);

    // Gate 1: flip the enable switch.
    await enableSwitch(page).click();

    // The backend radiogroup now appears.
    const group = backendGroup(page);
    await expect(group).toBeVisible();

    // The two on-device options are grouped under the "Stays on your device"
    // divider, and the two cloud options under "Sends a metric snapshot online".
    await expect(group.getByText(/stays on your device/i)).toBeVisible();
    await expect(group.getByText(/sends a metric snapshot online/i)).toBeVisible();

    // A privacy-default on-device backend is pre-selected (WebLLM), and NO cloud
    // backend is auto-selected (UX §3.3; §9.5).
    const webllm = backendOption(page, /in-browser \(webllm\)/i);
    await expect(webllm).toHaveAttribute('aria-checked', 'true');
    await expect(backendOption(page, /claude/i)).toHaveAttribute('aria-checked', 'false');
    await expect(backendOption(page, /openai-compatible/i)).toHaveAttribute(
      'aria-checked',
      'false',
    );

    // The on-device options carry the color-independent privacy badge text.
    await expect(group.getByText(/on-device · zero egress/i).first()).toBeVisible();
    await expect(group.getByText(/connects online/i).first()).toBeVisible();
  });
});

// ── 2. Cloud consent gate (two-gate) ─────────────────────────────────────────

test.describe('AI Insights — Cloud consent gate', () => {
  test.beforeEach(async ({ page }) => {
    await installLLMNetworkGuard(page);
    // Start enabled (on-device default) so we can immediately exercise selecting
    // a cloud backend without re-toggling Gate 1.
    await seedAiInsightsSettings(page, { enabled: true, backend: 'webllm' });
    await openAiInsightsPanel(page);
  });

  test('selecting Claude opens the consent dialog; Enable is disabled until acknowledged (§9.5)', async ({
    page,
  }) => {
    await backendOption(page, /claude/i).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/send metric summaries to claude/i)).toBeVisible();

    // The two-block contract is present: what leaves vs what never leaves.
    await expect(dialog.getByText(/what leaves your device/i)).toBeVisible();
    await expect(dialog.getByText(/what never leaves your device/i)).toBeVisible();
    await expect(dialog.getByText(/raw signals/i)).toBeVisible();

    // Enable is disabled until the acknowledgement checkbox is ticked.
    const enable = dialog.getByRole('button', { name: /^enable$/i });
    await expect(enable).toBeDisabled();

    await dialog.getByRole('checkbox').check();
    await expect(enable).toBeEnabled();
  });

  test('cancelling consent does NOT enable the cloud backend, persists no consent (§9.6)', async ({
    page,
  }) => {
    await backendOption(page, /claude/i).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Selection reverted: WebLLM remains selected, Claude is NOT selected.
    await expect(backendOption(page, /in-browser \(webllm\)/i)).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(backendOption(page, /claude/i)).toHaveAttribute('aria-checked', 'false');

    // No consent persisted (the accordion trigger would otherwise show a
    // "Connects online" pill once a cloud backend committed).
    await expect(page.getByRole('button', { name: /ai insights.*on-device/i })).toBeVisible();
  });

  test('Escape closes the consent dialog without enabling the cloud backend (§9.6, §9.10)', async ({
    page,
  }) => {
    await backendOption(page, /claude/i).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await expect(backendOption(page, /in-browser \(webllm\)/i)).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(backendOption(page, /claude/i)).toHaveAttribute('aria-checked', 'false');
  });

  test('acknowledging + Enable commits the cloud backend (§9.5)', async ({ page }) => {
    await backendOption(page, /claude/i).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: /^enable$/i }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Claude is now the selected backend, and the accordion trigger reflects the
    // online/cloud state with its color-independent "Connects online" pill.
    await expect(backendOption(page, /claude/i)).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('button', { name: /ai insights.*connects online/i })).toBeVisible();
  });
});

// ── 3. Local backend needs no consent ───────────────────────────────────────

test.describe('AI Insights — Local backend (no consent)', () => {
  test('an on-device backend is committed with NO consent dialog and NO online pill (§9.6)', async ({
    page,
  }) => {
    await installLLMNetworkGuard(page);
    // Enabled with the on-device default (WebLLM) and NO consent recorded.
    await seedAiInsightsSettings(page, {
      enabled: true,
      backend: 'webllm',
      consentAt: null,
      consentContractVersion: null,
    });
    await openAiInsightsPanel(page);

    // The local backend is the active selection (no consent was ever needed to
    // get here — local backends never egress; UX §3.2). Note: on-device backends
    // can be unavailable in a headless browser (no WebGPU / Chrome built-in AI),
    // so we assert the selection + no-consent state rather than a (possibly
    // disabled) re-selection click.
    await expect(backendOption(page, /in-browser \(webllm\)/i)).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // No consent dialog is present for a local backend.
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // The accordion trigger shows the color-independent "On-device" pill, never
    // "Connects online" — proving no cloud egress contract was entered.
    await expect(page.getByRole('button', { name: /ai insights.*on-device/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /ai insights.*connects online/i })).toHaveCount(
      0,
    );
  });
});

// ── 4. Opt-in visibility of the in-app InsightTrigger ────────────────────────

test.describe('AI Insights — Opt-in trigger visibility', () => {
  test.beforeEach(async ({ page }) => {
    await installLLMNetworkGuard(page);
  });

  test('Summarize trigger is ABSENT on the Dashboard when AI Insights is disabled (§9.1)', async ({
    page,
  }) => {
    // Disabled (default). Seed sessions so the dashboard is populated.
    await seedAiInsightsSettings(page, { enabled: false });
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
    await seedSessions(page, 3);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // No "✨ Summarize" / "Explain" affordance renders anywhere (UX §2.2).
    await expect(
      page.getByRole('button', { name: /summarize the selected date range/i }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: /explain.*trend/i })).toHaveCount(0);
  });

  test('Summarize trigger APPEARS on the Dashboard when AI Insights is enabled (§9.1)', async ({
    page,
  }) => {
    await seedAiInsightsSettings(page, { enabled: true, backend: 'webllm' });
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
    await seedSessions(page, 3);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await expect(
      page.getByRole('button', { name: /summarize the selected date range/i }),
    ).toBeVisible();
  });

  test('Summarize-this-night trigger is gated by the opt-in flag on Session Detail (§9.1)', async ({
    page,
  }) => {
    // Disabled first: no trigger.
    await seedAiInsightsSettings(page, { enabled: false });
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
    await seedSessions(page, 3);
    await page.goto(`/sessions/${SEEDED_SESSION_ID}`);
    await expect(page.getByRole('button', { name: /summarize this night/i })).toHaveCount(0);
  });

  test('Summarize-this-night trigger appears on Session Detail when enabled (§9.1)', async ({
    page,
  }) => {
    await seedAiInsightsSettings(page, { enabled: true, backend: 'webllm' });
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
    await seedSessions(page, 3);
    await page.goto(`/sessions/${SEEDED_SESSION_ID}`);
    await expect(page.getByRole('button', { name: /summarize this night/i })).toBeVisible();
  });
});

// ── 5. Drawer: safe idle state + needs-config recovery deep-link ─────────────

test.describe('AI Insights — Drawer safe state + recovery', () => {
  test.beforeEach(async ({ page }) => {
    await installLLMNetworkGuard(page);
  });

  test('clicking a trigger opens the non-modal drawer in a safe idle state (chips, no generation) (§9.1, §9.10)', async ({
    page,
  }) => {
    // On-device backend so there is no consent/key gate to hit — pure idle state.
    await seedAiInsightsSettings(page, { enabled: true, backend: 'webllm' });
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
    await seedSessions(page, 3);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.getByRole('button', { name: /summarize the selected date range/i }).click();

    // The non-modal drawer opens (role="complementary", labelled "AI insight").
    const drawer = page.getByRole('complementary', { name: /ai insight/i });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('heading', { name: /ai summary/i })).toBeVisible();
    await expect(drawer.getByText(/summary of/i)).toBeVisible();

    // Idle: the safe primary action + suggested chips are present, and NO
    // generation has begun (no Stop button). Nothing has egressed.
    await expect(drawer.getByRole('button', { name: /generate summary/i })).toBeVisible();
    const chips = drawer.getByRole('group', { name: /suggested questions/i });
    await expect(chips).toBeVisible();
    await expect(chips.getByRole('button').first()).toBeVisible();
    await expect(drawer.getByRole('button', { name: /^stop$/i })).toHaveCount(0);
  });

  test('cloud backend without consent: Generate surfaces needs-setup with a deep-link to /settings#ai-insights (§9.9, m1)', async ({
    page,
  }) => {
    // Enabled, Claude selected, but NO consent recorded and NO key → the very
    // first Generate short-circuits to a needs-setup state with NO egress.
    await seedAiInsightsSettings(page, {
      enabled: true,
      backend: 'anthropic',
      consentAt: null,
      consentContractVersion: null,
    });
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
    await seedSessions(page, 3);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.getByRole('button', { name: /summarize the selected date range/i }).click();
    const drawer = page.getByRole('complementary', { name: /ai insight/i });
    await expect(drawer).toBeVisible();

    // The per-output egress reminder is present for a cloud backend (UX §4.3).
    await expect(drawer.getByText(/sends a metric snapshot/i)).toBeVisible();

    // Trigger the run: it short-circuits to the needs-consent/needs-config state
    // (no provider call) and surfaces the "Finish setup in Settings" action.
    await drawer.getByRole('button', { name: /generate summary/i }).click();

    const finishSetup = drawer.getByRole('button', { name: /finish setup in settings/i });
    await expect(finishSetup).toBeVisible();

    // Deep-link (m1): clicking it lands on /settings#ai-insights with the AI
    // Insights panel expanded.
    await finishSetup.click();
    await expect(page).toHaveURL(/\/settings#ai-insights$/);
    await expect(page.getByRole('button', { name: /ai insights/i })).toBeVisible();
    // The deep-link opens the Integrations tab and expands the AI Insights item,
    // so its content region (and enable switch inside it) is visible.
    await expect(aiInsightsRegion(page)).toBeVisible();
    await expect(enableSwitch(page)).toBeVisible();
  });
});

// ── 6. Accessibility smoke ───────────────────────────────────────────────────

test.describe('AI Insights — Accessibility smoke', () => {
  test.beforeEach(async ({ page }) => {
    await installLLMNetworkGuard(page);
  });

  test('backend radiogroup is keyboard-operable: arrow keys move selection (§9.10)', async ({
    page,
  }) => {
    // Drive the radiogroup over the two CLOUD options, which are always present
    // and selectable regardless of WebGPU / Chrome-AI availability (the on-device
    // options are disabled in a headless browser). Pre-grant valid consent so
    // arrow-switching between two already-consented cloud backends does NOT pop
    // the consent dialog — isolating the keyboard-navigation behaviour.
    // consentContractVersion must equal EGRESS_CONTRACT_VERSION (currently 1) so
    // the prior consent is considered fresh (src/types/settings.ts).
    await seedAiInsightsSettings(page, {
      enabled: true,
      backend: 'anthropic',
      consentAt: '2026-01-01T00:00:00.000Z',
      consentContractVersion: 1,
    });
    await openAiInsightsPanel(page);

    const group = backendGroup(page);
    await expect(group).toBeVisible();

    const claude = backendOption(page, /claude/i);
    const openai = backendOption(page, /openai-compatible/i);
    await expect(claude).toHaveAttribute('aria-checked', 'true');

    // Focus the roving tab stop (the selected option) and move with ArrowDown.
    await claude.focus();
    await page.keyboard.press('ArrowDown');

    // Selection moved to the next option in the roving order. Consent is already
    // valid, so switching between consented cloud backends opens no dialog.
    await expect(openai).toHaveAttribute('aria-checked', 'true');
    await expect(claude).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // ArrowUp moves selection back to Claude (roving wraps within enabled order).
    await page.keyboard.press('ArrowUp');
    await expect(claude).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('drawer is dismissible via the close control and via Escape (§9.10)', async ({ page }) => {
    await seedAiInsightsSettings(page, { enabled: true, backend: 'webllm' });
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
    await seedSessions(page, 3);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    const openTrigger = page.getByRole('button', {
      name: /summarize the selected date range/i,
    });

    // Close via the explicit close control with a REAL pointer click. The drawer
    // is a NON-modal side rail whose top-right "×" overlaps page chrome (e.g. the
    // header theme control) at this viewport. The close button must therefore sit
    // ABOVE that chrome in the stacking order so a real pointer click lands on it
    // rather than being intercepted by the header. Playwright's click performs
    // actionability + hit-testing, so this assertion FAILS if the overlap
    // regresses (pointer intercepted), guarding the stacking-context fix.
    await openTrigger.click();
    const drawer = page.getByRole('complementary', { name: /ai insight/i });
    await expect(drawer).toBeVisible();
    const closeButton = drawer.getByRole('button', { name: /close ai insight/i });
    await closeButton.click();
    await expect(page.getByRole('complementary', { name: /ai insight/i })).toHaveCount(0);

    // Re-open and close via Escape.
    await openTrigger.click();
    await expect(page.getByRole('complementary', { name: /ai insight/i })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('complementary', { name: /ai insight/i })).toHaveCount(0);
  });
});
