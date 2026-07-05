/**
 * Main dashboard view — the "Signal Deck" home dashboard.
 *
 * A dense monospace command surface: a Therapy-Index verdict + AI narrative
 * anchor the left, a 12-month AHI calendar heatmap is the spine, and
 * small-multiples, distribution plots, wearable correlation lanes, a TECSA
 * dumbbell, and the session log fill the deck. The implementation (data hooks,
 * empty/error states, and all panels) lives in {@link SignalDeck}; this module
 * preserves the router's default-export contract
 * (`lazy(() => import('@/views/Dashboard/Dashboard'))`).
 *
 * @module views/Dashboard/Dashboard
 */

import SignalDeck from './signalDeck/SignalDeck';

export default function Dashboard() {
  return <SignalDeck />;
}
