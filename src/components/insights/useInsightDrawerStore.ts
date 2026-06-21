/**
 * `useInsightDrawerStore` — the tiny, NON-persisted state container for "which
 * insight is currently open in the drawer" (AI Insights UX §4.1).
 *
 * A single drawer instance lives at the app shell and is fed by triggers
 * scattered across views ({@link file://src/components/insights/InsightTrigger.tsx}).
 * Rather than thread an `onOpen` callback through every view, the triggers push
 * their request here and the drawer subscribes. This keeps the wiring additive
 * and avoids prop-drilling.
 *
 * Privacy & scope: this holds only the already-built {@link InsightInput} (which
 * is the app's already-computed, redaction-guarded snapshot input) plus an
 * optional narration brief. It is **deliberately not persisted** — an insight
 * request is ephemeral UI state, never written to storage and never restored
 * across reloads (nothing about a user's data lingers here).
 *
 * @module components/insights/useInsightDrawerStore
 */

import { create } from 'zustand';

import type { InsightInput } from '@/services/llm/runInsight';

/** A single, scoped insight request the drawer should present. */
export interface InsightRequest {
  /** The already-built grounded-context input (see the input helpers). */
  readonly input: InsightInput;
  /** An optional narration brief / suggested-chip prompt (UX §7.6). */
  readonly userBrief?: string;
  /**
   * A short human label for the drawer's scope subhead, e.g.
   * "the night of 20 Jun 2026" or "14–20 Jun 2026". The view that opens the
   * drawer knows the friendly scope; the drawer renders it verbatim.
   */
  readonly scopeLabel: string;
}

interface InsightDrawerState {
  /** Whether the drawer is open. */
  readonly open: boolean;
  /** The active request, or `null` when the drawer is closed/idle. */
  readonly request: InsightRequest | null;
  /** Open the drawer for a freshly built request (replaces any current one). */
  readonly openInsight: (request: InsightRequest) => void;
  /** Close the drawer and clear the request. */
  readonly close: () => void;
}

/**
 * The drawer store. Not persisted (no `persist` middleware) — insight requests
 * are ephemeral and must never be written to storage (Privacy, Core Principle 1).
 */
export const useInsightDrawerStore = create<InsightDrawerState>((set) => ({
  open: false,
  request: null,
  openInsight: (request) => set({ open: true, request }),
  close: () => set({ open: false, request: null }),
}));
