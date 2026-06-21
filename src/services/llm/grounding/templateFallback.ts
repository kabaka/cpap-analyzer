/**
 * Non-generative, deterministic template fallback (design reference §4, §5).
 *
 * Used when (a) post-generation validation fails twice or (b) no model is
 * available at all. It renders an app-authored plain-language summary directly
 * from the {@link GroundedContext} — every number it contains comes verbatim
 * from a metric/trend `displayValue` that is, by construction, in the
 * `numericAllowList`. It therefore **cannot** contain an unverified number, and
 * its own output passes {@link validateNarrative} by construction.
 *
 * The output reads as prose (not a raw dump): it branches on availability so a
 * `null` rate is described as "too short to compute a reliable rate" rather than
 * shown as a blank or a zero, and it attaches each metric's caveat when present.
 *
 * Pure and deterministic; no I/O.
 *
 * @module services/llm/grounding/templateFallback
 */

import type { GroundedContext, MetricSnapshot, TrendSnapshot } from '../context/types';

/** The standard "AI narration unavailable" lead-in (owned with `ux`/docs). */
export const FALLBACK_NOTICE = 'AI narration is unavailable, so here is the computed summary.';

/**
 * Render a deterministic, allow-list-safe summary for a grounded context.
 *
 * @param context the snapshot to summarize.
 * @returns plain-language prose containing only computed, verified figures.
 */
export function renderTemplateFallback(context: GroundedContext): string {
  switch (context.insightType) {
    case 'single-night':
      return renderSingleNight(context);
    case 'date-range':
      return renderDateRange(context);
    case 'explain':
      return renderExplain(context);
    case 'clinical-context':
      return renderClinicalContext(context);
  }
}

// ─── per-insight renderers ──────────────────────────────────────────────────

function renderSingleNight(context: GroundedContext): string {
  const lines: string[] = [`Summary for ${context.scope.startDate}:`];
  for (const m of context.metrics) {
    const sentence = metricSentence(m);
    if (sentence !== null) lines.push(`• ${sentence}`);
  }
  if (lines.length === 1) lines.push('• No metrics were available for this night.');
  return lines.join('\n');
}

function renderDateRange(context: GroundedContext): string {
  const { startDate, endDate, nightCount, nightsWithDefinedRate } = context.scope;
  const lines: string[] = [
    `Summary for ${startDate} to ${endDate} (${nightCount} night${plural(
      nightCount,
    )}, ${nightsWithDefinedRate} with a defined per-hour rate):`,
  ];
  if (context.trends.length === 0) {
    lines.push('• No trends were computed for this range.');
  } else {
    for (const t of context.trends) lines.push(`• ${trendSentence(t)}`);
  }
  return lines.join('\n');
}

function renderExplain(context: GroundedContext): string {
  const lines: string[] = [];
  if (context.series) {
    const s = context.series;
    lines.push(`${s.chartTitle}: ${s.caption}`);
    const present = s.points.filter((p) => p.availability === 'present');
    lines.push(
      `This chart plots ${s.points.length} point${plural(s.points.length)} in ${s.yUnit}, of which ${
        present.length
      } have a recorded value.`,
    );
    for (const r of s.referenceLines) {
      lines.push(`• Reference line — ${r.label}: ${r.value} ${r.unit}.`);
    }
  }
  for (const m of context.metrics) {
    const sentence = metricSentence(m);
    if (sentence !== null) lines.push(`• ${sentence}`);
  }
  if (lines.length === 0) lines.push('No data was available to explain this view.');
  return lines.join('\n');
}

function renderClinicalContext(context: GroundedContext): string {
  const lines: string[] = [`Where these values sit relative to your configured references:`];
  const ahi = findMetric(context, 'ahi');
  const band = findMetric(context, 'severityBand');
  const { mild, moderate, severe } = context.clinical.ahiThresholds;

  if (ahi && ahi.availability === 'present' && band?.displayValue) {
    lines.push(
      `• Your AHI is ${ahi.displayValue} ${ahi.unit}, which falls in the "${band.displayValue}" band under your active thresholds (mild ${mild}, moderate ${moderate}, severe ${severe} events/h).` +
        caveatSuffix(ahi),
    );
  } else if (ahi && ahi.availability === 'undefined-rate') {
    lines.push(
      '• Your AHI is not defined for this night — the recording was too short to compute a reliable per-hour rate.',
    );
  }

  const usage = findMetric(context, 'usageHours');
  if (usage && usage.availability === 'present') {
    lines.push(
      `• Usage was ${usage.displayValue} ${usage.unit}. The CMS adherence floor is ${context.clinical.cmsComplianceHours} hours and a commonly cited good-adherence target is ${context.clinical.recommendedUsageHours} hours.`,
    );
  }
  lines.push(`Note: ${context.clinical.referenceProvenance}`);
  return lines.join('\n');
}

// ─── sentence builders ──────────────────────────────────────────────────────

/** A single metric as a sentence, branching on availability. Null ⇒ skip. */
function metricSentence(m: MetricSnapshot): string | null {
  switch (m.availability) {
    case 'present': {
      if (m.displayValue === null) return null;
      const unit = m.unit === '' ? '' : ` ${m.unit}`;
      return `${m.label}: ${m.displayValue}${unit}.${caveatSuffix(m)}`;
    }
    case 'undefined-rate':
      return `${m.label}: not defined — the recording was too short to compute a reliable per-hour rate.`;
    case 'unavailable':
      // Quietly omit absent channels to keep the summary readable.
      return null;
  }
}

function caveatSuffix(m: MetricSnapshot): string {
  return m.caveat ? ` (${m.caveat}.)` : '';
}

/** A trend as a sentence, always carrying its qualifier. */
function trendSentence(t: TrendSnapshot): string {
  if (t.slopeDisplay === null || t.strength === 'negligible' || t.direction === 'flat') {
    return `${t.label}: ${t.qualifier}`;
  }
  return `${t.label}: ${t.direction} at ${t.slopeDisplay} ${t.slopeUnit} over ${t.n} night${plural(
    t.n,
  )}. ${t.qualifier}`;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function findMetric(context: GroundedContext, id: string): MetricSnapshot | undefined {
  return context.metrics.find((m) => m.id === id);
}

function plural(n: number): string {
  return n === 1 ? '' : 's';
}
