/**
 * View (lens) identifiers and labels for the Event Explorer results area.
 *
 * Kept in a component-free module so the constants can be shared with the
 * container without tripping React Fast Refresh's component-only export rule.
 *
 * @module views/Explore/EventExplorer/viewOptions
 */

/** View identifiers (also used in the `view` URL param). */
export type ViewId = 'histogram' | 'scatter' | 'distributions' | 'intervals' | 'clusters';

export const VIEW_OPTIONS: readonly { value: ViewId; label: string }[] = [
  { value: 'histogram', label: 'Duration histogram' },
  { value: 'scatter', label: 'Scatter' },
  { value: 'distributions', label: 'Per-type distributions' },
  { value: 'intervals', label: 'Inter-event intervals' },
  { value: 'clusters', label: 'Clusters' },
];
