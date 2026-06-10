/**
 * Route wrapper that keys {@link SignalViewer} by the active `:sessionId`.
 *
 * The SignalViewer instance is otherwise reused across `:sessionId` route
 * changes (the parent SessionDetail route owns the param), so per-session state
 * — e.g. the hidden-channel set seeded from localStorage in a lazy `useState`
 * initializer — would leak from one session into the next, and the persist
 * effect would then overwrite the new session's stored set with the old one.
 * Keying on `sessionId` forces a fresh mount per session, re-seeding that state
 * correctly.
 *
 * @module views/Sessions/KeyedSignalViewer
 */

import { useParams } from 'react-router-dom';
import SignalViewer from './SignalViewer';

export default function KeyedSignalViewer() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <SignalViewer key={sessionId} />;
}
