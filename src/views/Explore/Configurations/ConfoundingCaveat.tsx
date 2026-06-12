/**
 * ConfoundingCaveat — the persistent warning banner that sits immediately
 * under the configuration comparison charts. Reminds the user that periods
 * differ in more than their machine settings (season, weight, illness,
 * adherence) so observed differences are associations, not proven effects.
 *
 * Uses the **warning** register (`--color-warning*`) — noticed but not
 * alarmist — per the ui-design spec. Deliberately NOT styled with the
 * status-severe palette: the goal is to keep statistical humility visible, not
 * to imply something is wrong with the user's therapy.
 *
 * @module views/Explore/Configurations/ConfoundingCaveat
 */

import styles from './ConfoundingCaveat.module.css';

export const CONFOUNDING_CAVEAT_TEXT =
  'Configuration periods differ in more than their settings — season, weight, illness, and adherence all vary. Differences shown are associations, not proven effects of the setting change.';

export interface ConfoundingCaveatProps {
  readonly className?: string;
}

export function ConfoundingCaveat({ className }: ConfoundingCaveatProps): JSX.Element {
  const cls = [styles.root, className ?? ''].filter(Boolean).join(' ');
  return (
    <div className={cls} role="note" aria-label="Confounding caveat">
      <span className={styles.icon} aria-hidden="true">
        ⚠
      </span>
      <p className={styles.body}>{CONFOUNDING_CAVEAT_TEXT}</p>
    </div>
  );
}

export default ConfoundingCaveat;
