/**
 * AI Insights component family — barrel export.
 *
 * The shared, reusable atoms for AI-generated content surfaces (ADR 0024; design
 * references `docs/design/ai-insights-ux.md`, `docs/design/ai-insights-visual.md`).
 * These are the ONLY place the reserved `--color-ai*` tokens are consumed in UI
 * chrome (visual spec §1.4); they must never appear on deterministic `(?)`
 * glossary help.
 *
 * @module components/ai
 */

export { AiMarker } from './AiMarker';
export type { AiMarkerProps, AiMarkerVariant } from './AiMarker';

export { InsightCaveat, MedicalDisclaimer, MEDICAL_DISCLAIMER_TEXT } from './InsightCaveat';
export type { InsightCaveatProps, MedicalDisclaimerProps } from './InsightCaveat';
