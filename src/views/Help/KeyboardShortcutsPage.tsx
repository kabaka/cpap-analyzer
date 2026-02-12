/**
 * Standalone page wrapper for the keyboard shortcuts reference.
 *
 * Renders the KeyboardShortcuts dialog in an always-open state so it
 * can be accessed directly via the /help/keyboard-shortcuts route.
 *
 * @module views/Help/KeyboardShortcutsPage
 */

import { useNavigate } from 'react-router-dom';
import { KeyboardShortcuts } from '@/components/help/KeyboardShortcuts';

export default function KeyboardShortcutsPage() {
  const navigate = useNavigate();

  return (
    <KeyboardShortcuts
      open={true}
      onOpenChange={(open) => {
        if (!open) {
          void navigate('/help');
        }
      }}
    />
  );
}
