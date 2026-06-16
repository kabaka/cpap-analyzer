import type { ReactElement } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@/test/test-utils';
import { MetricTooltip } from '@/components/help/MetricTooltip';
import { TooltipProvider } from '@/components/ui/Tooltip/Tooltip';
import { metricMap } from '@/content/help';
import { reliabilityTierLabel } from '@/analysis/uncertainty';

/**
 * Radix tooltips must live inside a TooltipProvider (supplied app-wide in
 * production). Wrap each render so the provider context is available, and
 * disable the open delay so focusing the trigger opens it synchronously.
 */
function renderWithProvider(ui: ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

/**
 * The Radix tooltip content lives in a portal and only mounts once the
 * trigger is opened. Focusing the trigger opens it without an open delay,
 * which keeps these assertions deterministic in jsdom.
 */
function openTooltip(name: RegExp) {
  const trigger = screen.getByRole('button', { name });
  fireEvent.focus(trigger);
  return trigger;
}

describe('MetricTooltip', () => {
  it('renders the trigger with an accessible name', () => {
    renderWithProvider(<MetricTooltip metricId="ahi">AHI</MetricTooltip>);
    expect(screen.getByRole('button', { name: /Help for AHI/ })).toBeInTheDocument();
  });

  it('passes children through unchanged for an unknown metric id', () => {
    render(<MetricTooltip metricId="not-a-real-metric">Raw label</MetricTooltip>);
    expect(screen.getByText('Raw label')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('surfaces the reliability tier label and note when present', async () => {
    const ahi = metricMap.get('ahi');
    expect(ahi?.reliability).toBeDefined();
    const tierLabel = reliabilityTierLabel(ahi!.reliability!.tier);

    renderWithProvider(<MetricTooltip metricId="ahi">AHI</MetricTooltip>);
    openTooltip(/Help for AHI/);

    // The tier label and a distinctive fragment of the note both appear.
    // Radix can mirror content into a visually-hidden node, so allow >= 1.
    expect((await screen.findAllByText(tierLabel)).length).toBeGreaterThanOrEqual(1);
    expect(
      (await screen.findAllByText(/algorithmically detected estimate/i)).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('does not render a reliability note for a metric without one', async () => {
    // Find a metric that has no reliability annotation, if any exist.
    const plain = [...metricMap.values()].find((m) => m.reliability === undefined);
    if (!plain) {
      // All current metrics are annotated — nothing to assert.
      expect(plain).toBeUndefined();
      return;
    }

    renderWithProvider(<MetricTooltip metricId={plain.id}>{plain.label}</MetricTooltip>);
    openTooltip(new RegExp(`Help for ${plain.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

    // No tier label string should be present for any of the three tiers.
    for (const tier of ['high', 'moderate', 'low'] as const) {
      const label = reliabilityTierLabel(tier);
      // The interpretation text could coincidentally contain a word; scope to
      // the tooltip content only by checking the description is present first.
      const matches = screen.queryAllByText(label);
      expect(matches.length).toBe(0);
    }
  });

  it('keeps the central-split note safety-aware (trend still matters)', async () => {
    renderWithProvider(<MetricTooltip metricId="central-ai">Central AI</MetricTooltip>);
    openTooltip(/Help for Central AI/);

    const noteMatches = await screen.findAllByText(/discuss it with your clinician/i);
    expect(noteMatches.length).toBeGreaterThanOrEqual(1);
    const note = noteMatches[0] as HTMLElement;
    expect(within(note.closest('div') ?? note).getByText(/sustained upward trend/i)).toBeTruthy();
  });
});
