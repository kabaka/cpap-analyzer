/**
 * Recent Sessions panel — wrapper around SessionsTable for the dashboard.
 *
 * @module views/Dashboard/panels/RecentSessions
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui';
import { SessionsTable } from '@/components/domain/SessionsTable';
import type { Session, NightlyAggregate } from '@/types';
import styles from './RecentSessions.module.css';

interface RecentSessionsProps {
  sessions: Session[];
  aggregates: NightlyAggregate[];
  loading: boolean;
}

const RecentSessions = React.memo(function RecentSessions({
  sessions,
  aggregates,
  loading,
}: RecentSessionsProps) {
  if (loading) {
    return (
      <Card className={styles.card}>
        <h3 className={styles.title}>Recent Sessions</h3>
        <div className={styles.skeleton} />
      </Card>
    );
  }

  return (
    <Card className={styles.card}>
      <div className={styles.header}>
        <h3 className={styles.title}>Recent Sessions</h3>
        <Link to="/sessions" className={styles.viewAll}>
          View all sessions →
        </Link>
      </div>
      <SessionsTable sessions={sessions} aggregates={aggregates} limit={7} />
    </Card>
  );
});

export default RecentSessions;
