/**
 * AI Insights in-app surfaces — barrel export (UX §4, §5; visual spec §3).
 *
 * The non-modal {@link InsightDrawer} (mounted once at the app shell) plus the
 * reusable {@link InsightTrigger} affordance that opens it, the tiny
 * non-persisted drawer state container, and the input-builder helpers that turn
 * the app's already-computed data into the grounded-context request the engine
 * narrates. These are the only surfaces that render generated AI content; all
 * are absent entirely when AI Insights is disabled (opt-in; UX §2.2).
 *
 * @module components/insights
 */

export { InsightDrawer } from './InsightDrawer';
export { InsightTrigger } from './InsightTrigger';
export type { InsightTriggerProps } from './InsightTrigger';

export { useInsightDrawerStore } from './useInsightDrawerStore';
export type { InsightRequest } from './useInsightDrawerStore';

export {
  buildGroundingCommon,
  buildSingleNightInput,
  buildClinicalContextInput,
  buildDateRangeInput,
  computeDateRangeTrends,
  machineClassOf,
} from './buildInsightInput';
export type { InsightSettingsSnapshot } from './buildInsightInput';

export { chipsForInsight } from './chips';
export type { SuggestedChip } from './chips';

export { formatScopeDate, nightScopeLabel, rangeScopeLabel } from './scopeLabel';

export { SourcePanel } from './SourcePanel';
export type { SourcePanelProps } from './SourcePanel';
