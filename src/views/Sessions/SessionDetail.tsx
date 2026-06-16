/**
 * Session Detail view — comprehensive single-session analysis.
 *
 * Displays session header, key therapy metrics (AHI, leak, pressure, SpO₂),
 * an event timeline visualisation, and an event summary table.
 * Supports a nested child route for the Signal Viewer via `<Outlet />`.
 *
 * @module views/Sessions/SessionDetail
 */

import { useMemo } from 'react';
import { Link, Outlet, useMatch, useNavigate, useParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  Skeleton,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Tooltip,
} from '@/components/ui';
import { useSessionDetail, useEventData } from '@/hooks/useSignalData';
import { formatMetric } from '@/analysis/uncertainty';
import { classifyAhiSeverity } from '@/analysis/clinical';
import type { Event, EventType, MachineType, NightlyAggregate } from '@/types';
import styles from './SessionDetail.module.css';

// ── Constants ────────────────────────────────────────────────────

/** Human-readable labels for machine therapy modes. */
const MACHINE_TYPE_LABELS: Record<MachineType, string> = {
  cpap: 'CPAP',
  apap: 'APAP',
  bipap: 'BiPAP',
  vpap: 'VPAP',
  asv: 'ASV',
};

/** Color mapping for event types on the timeline. */
const EVENT_COLORS: Record<string, string> = {
  ObstructiveApnea: 'var(--color-status-severe)',
  CentralApnea: 'var(--color-status-moderate)',
  MixedApnea: 'var(--color-status-moderate)',
  UnclassifiedApnea: 'var(--color-chart-2)',
  Hypopnea: 'var(--color-status-mild)',
  RERA: 'var(--color-chart-4)',
  FlowLimitation: 'var(--color-chart-6)',
  LargeLeak: 'var(--color-chart-5)',
  PeriodicBreathing: 'var(--color-chart-5)',
  ClearAirway: 'var(--color-chart-3)',
  Vibratory: 'var(--color-text-muted)',
  ChecksumError: 'var(--color-text-muted)',
};

/** Human-readable labels for event types. */
const EVENT_TYPE_LABELS: Record<EventType, string> = {
  ObstructiveApnea: 'Obstructive Apnea',
  CentralApnea: 'Central Apnea',
  MixedApnea: 'Mixed Apnea',
  UnclassifiedApnea: 'Unclassified Apnea',
  Hypopnea: 'Hypopnea',
  RERA: 'RERA',
  FlowLimitation: 'Flow Limitation',
  LargeLeak: 'Large Leak',
  PeriodicBreathing: 'Periodic Breathing',
  ClearAirway: 'Clear Airway',
  Vibratory: 'Vibratory Snore',
  ChecksumError: 'Checksum Error',
};

/** Display order for the event summary table. */
const EVENT_TYPE_ORDER: EventType[] = [
  'ObstructiveApnea',
  'CentralApnea',
  'MixedApnea',
  'UnclassifiedApnea',
  'Hypopnea',
  'RERA',
  'FlowLimitation',
  'LargeLeak',
  'PeriodicBreathing',
];

// ── Helpers ──────────────────────────────────────────────────────

/** Map AHI severity to Badge variant. */
function ahiBadgeVariant(severity: string): 'success' | 'warning' | 'danger' {
  switch (severity) {
    case 'normal':
      return 'success';
    case 'mild':
    case 'moderate':
      return 'warning';
    default:
      return 'danger';
  }
}

/** Format a date string (YYYY-MM-DD) to a human-friendly format. */
function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Format an ISO timestamp to a locale time string. */
function formatTime(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Format minutes to Xh Ym. */
function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/** Format a number to a fixed decimal string, with fallback. */
function fmt(value: number | null | undefined, decimals = 1, fallback = '—'): string {
  if (value == null || Number.isNaN(value)) return fallback;
  return value.toFixed(decimals);
}

/** Whether this machine type has bilevel pressure data. */
function isBilevel(type: MachineType): boolean {
  return type === 'bipap' || type === 'vpap' || type === 'asv';
}

// ── EventTimeline component ──────────────────────────────────────

interface EventTimelineProps {
  events: Event[];
  sessionStart: number;
  sessionEnd: number;
}

function EventTimeline({ events, sessionStart, sessionEnd }: EventTimelineProps) {
  const sessionDurationMs = sessionEnd - sessionStart;

  if (sessionDurationMs <= 0) return null;

  return (
    <div className={styles.timelineSection}>
      <h2 className={styles.sectionTitle}>Event Timeline</h2>
      <div
        className={styles.timelineContainer}
        role="img"
        aria-label={`Event timeline showing ${events.length} events across the session`}
      >
        {events.map((event) => {
          const leftPct = ((event.timestamp - sessionStart) / sessionDurationMs) * 100;
          const widthPct = ((event.duration * 1000) / sessionDurationMs) * 100;
          const color = EVENT_COLORS[event.type] ?? 'var(--color-text-muted)';

          return (
            <Tooltip
              key={event.id}
              content={`${EVENT_TYPE_LABELS[event.type] ?? event.type}: ${event.duration.toFixed(1)}s`}
              side="top"
            >
              <div
                className={styles.timelineEvent}
                data-left={Math.max(0, Math.min(leftPct, 100))}
                data-width={Math.max(0.3, Math.min(widthPct, 100 - leftPct))}
                data-color={color}
                ref={(el) => {
                  if (el) {
                    el.style.setProperty('--evt-left', `${Math.max(0, Math.min(leftPct, 100))}%`);
                    el.style.setProperty(
                      '--evt-width',
                      `${Math.max(0.3, Math.min(widthPct, 100 - leftPct))}%`,
                    );
                    el.style.setProperty('--evt-color', color);
                  }
                }}
              />
            </Tooltip>
          );
        })}
      </div>
      <div className={styles.timelineLabels}>
        <span>{formatTime(new Date(sessionStart).toISOString())}</span>
        <span>{formatTime(new Date(sessionEnd).toISOString())}</span>
      </div>
      <div className={styles.timelineLegend}>
        {[
          { label: 'Obstructive', color: 'var(--color-status-severe)' },
          { label: 'Central', color: 'var(--color-status-moderate)' },
          { label: 'Hypopnea', color: 'var(--color-status-mild)' },
          { label: 'RERA', color: 'var(--color-chart-4)' },
          { label: 'Other', color: 'var(--color-text-muted)' },
        ].map((item) => (
          <span key={item.label} className={styles.legendItem}>
            <span
              className={styles.legendSwatch}
              ref={(el) => {
                if (el) el.style.setProperty('--swatch-color', item.color);
              }}
            />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── EventSummaryTable component ──────────────────────────────────

interface EventSummary {
  type: EventType;
  label: string;
  count: number;
  totalDurationSec: number;
  avgDurationSec: number;
  color: string;
}

interface EventSummaryTableProps {
  events: Event[];
}

function EventSummaryTable({ events }: EventSummaryTableProps) {
  const summaries = useMemo<EventSummary[]>(() => {
    const map = new Map<EventType, { count: number; totalDuration: number }>();

    for (const event of events) {
      const existing = map.get(event.type);
      if (existing) {
        existing.count += 1;
        existing.totalDuration += event.duration;
      } else {
        map.set(event.type, { count: 1, totalDuration: event.duration });
      }
    }

    return EVENT_TYPE_ORDER.filter((type) => map.has(type))
      .map((type) => {
        const data = map.get(type);
        if (!data) return null;
        return {
          type,
          label: EVENT_TYPE_LABELS[type],
          count: data.count,
          totalDurationSec: data.totalDuration,
          avgDurationSec: data.count > 0 ? data.totalDuration / data.count : 0,
          color: EVENT_COLORS[type] ?? 'var(--color-text-muted)',
        };
      })
      .filter((s): s is EventSummary => s !== null);
  }, [events]);

  if (summaries.length === 0) return null;

  return (
    <div className={styles.tableSection}>
      <h2 className={styles.sectionTitle}>Event Summary</h2>
      <Card padding={false}>
        <div className={styles.tableWrapper}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event Type</TableHead>
                <TableHead className={styles.numericHead}>Count</TableHead>
                <TableHead className={styles.numericHead}>Total Duration</TableHead>
                <TableHead className={styles.numericHead}>Avg Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summaries.map((s) => (
                <TableRow key={s.type}>
                  <TableCell>
                    <span className={styles.typeCell}>
                      <span
                        className={styles.eventDot}
                        ref={(el) => {
                          if (el) el.style.setProperty('--dot-color', s.color);
                        }}
                        aria-hidden="true"
                      />
                      {s.label}
                    </span>
                  </TableCell>
                  <TableCell className={styles.numericCell}>{s.count}</TableCell>
                  <TableCell className={styles.numericCell}>
                    {formatDuration(s.totalDurationSec / 60)}
                  </TableCell>
                  <TableCell className={styles.numericCell}>
                    {s.avgDurationSec.toFixed(1)}s
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

// ── Metric Cards ─────────────────────────────────────────────────

/**
 * Respiratory Disturbance Index: AHI + RERA index. Prefer the stored `rdi`
 * field; fall back to `ahi + ahiRera` for aggregates persisted before the
 * field existed (see {@link NightlyAggregate.rdi}).
 */
function resolveRdi(aggregate: NightlyAggregate): number {
  return aggregate.rdi ?? aggregate.ahi + aggregate.ahiRera;
}

function AHICard({ aggregate }: { aggregate: NightlyAggregate }) {
  const severity = classifyAhiSeverity(aggregate.ahi);
  const badgeVariant = ahiBadgeVariant(severity);
  const rdi = resolveRdi(aggregate);

  return (
    <Card className={styles.metricCard}>
      <div className={styles.metricCardHeader}>
        <h3 className={styles.metricCardTitle}>AHI</h3>
        <Badge variant={badgeVariant} size="sm">
          {severity.charAt(0).toUpperCase() + severity.slice(1)}
        </Badge>
      </div>
      <div className={styles.metricPrimary}>
        <span
          className={`${styles.metricValue} ${styles[`ahi${severity.charAt(0).toUpperCase() + severity.slice(1)}`]}`}
        >
          {aggregate.ahi.toFixed(1)}
        </span>
        <span className={styles.metricUnit}>events/hr</span>
      </div>
      <div className={styles.metricSecondary}>
        <span className={styles.metricSecondaryLabel}>RDI</span>
        <span className={styles.metricSecondaryValue}>{fmt(rdi)}</span>
        <span className={styles.metricSecondaryUnit}>events/hr (incl. RERA)</span>
      </div>
      <div className={styles.metricBreakdown}>
        <div className={styles.breakdownItem}>
          <span className={styles.breakdownLabel}>Obstructive</span>
          <span className={styles.breakdownValue}>{fmt(aggregate.ahiObstructive)}</span>
        </div>
        <div className={styles.breakdownItem}>
          <span className={styles.breakdownLabel}>Central</span>
          <span className={styles.breakdownValue}>{fmt(aggregate.ahiCentral)}</span>
        </div>
        <div className={styles.breakdownItem}>
          <span className={styles.breakdownLabel}>Mixed</span>
          <span className={styles.breakdownValue}>{fmt(aggregate.ahiMixed)}</span>
        </div>
        {(aggregate.ahiUnclassified ?? 0) > 0 && (
          <div className={styles.breakdownItem}>
            <span className={styles.breakdownLabel}>Unclassified</span>
            <span className={styles.breakdownValue}>{fmt(aggregate.ahiUnclassified ?? 0)}</span>
          </div>
        )}
        <div className={styles.breakdownItem}>
          <span className={styles.breakdownLabel}>Hypopnea</span>
          <span className={styles.breakdownValue}>{fmt(aggregate.ahiHypopnea)}</span>
        </div>
        <div className={styles.breakdownItem}>
          <span className={styles.breakdownLabel}>RERA</span>
          <span className={styles.breakdownValue}>{fmt(aggregate.ahiRera)}</span>
        </div>
      </div>
    </Card>
  );
}

function LeakCard({ aggregate }: { aggregate: NightlyAggregate }) {
  return (
    <Card className={styles.metricCard}>
      <div className={styles.metricCardHeader}>
        <h3 className={styles.metricCardTitle}>Leak Rate</h3>
      </div>
      <div className={styles.metricPrimary}>
        <span className={styles.metricValue}>
          {formatMetric('leakMedian', aggregate.leakMedian)}
        </span>
        <span className={styles.metricUnit}>L/min median</span>
      </div>
      <div className={styles.metricBreakdown}>
        <div className={styles.breakdownItem}>
          <span className={styles.breakdownLabel}>95th %ile</span>
          <span className={styles.breakdownValue}>
            {formatMetric('leakP95', aggregate.leakP95)}
          </span>
        </div>
        <div className={styles.breakdownItem}>
          <span className={styles.breakdownLabel}>Max</span>
          <span className={styles.breakdownValue}>
            {formatMetric('leakMax', aggregate.leakMax)}
          </span>
        </div>
        <div className={styles.breakdownItem}>
          <span className={styles.breakdownLabel}>Large Leak</span>
          <span className={styles.breakdownValue}>
            {formatDuration(aggregate.leakDurationMinutes)}
          </span>
        </div>
      </div>
    </Card>
  );
}

function PressureCard({
  aggregate,
  machineType,
}: {
  aggregate: NightlyAggregate;
  machineType: MachineType;
}) {
  const bilevel = isBilevel(machineType);

  return (
    <Card className={styles.metricCard}>
      <div className={styles.metricCardHeader}>
        <h3 className={styles.metricCardTitle}>Pressure</h3>
        <Badge variant="default" size="sm">
          cmH₂O
        </Badge>
      </div>
      <div className={styles.metricPrimary}>
        <span className={styles.metricValue}>{fmt(aggregate.pressureMean)}</span>
        <span className={styles.metricUnit}>mean</span>
      </div>
      <div className={styles.metricBreakdown}>
        <div className={styles.breakdownItem}>
          <span className={styles.breakdownLabel}>Median</span>
          <span className={styles.breakdownValue}>{fmt(aggregate.pressureMedian)}</span>
        </div>
        <div className={styles.breakdownItem}>
          <span className={styles.breakdownLabel}>95th %ile</span>
          <span className={styles.breakdownValue}>{fmt(aggregate.pressureP95)}</span>
        </div>
        <div className={styles.breakdownItem}>
          <span className={styles.breakdownLabel}>Max</span>
          <span className={styles.breakdownValue}>{fmt(aggregate.pressureMax)}</span>
        </div>
        {bilevel && aggregate.epapMedian != null && (
          <div className={styles.breakdownItem}>
            <span className={styles.breakdownLabel}>EPAP</span>
            <span className={styles.breakdownValue}>{fmt(aggregate.epapMedian)}</span>
          </div>
        )}
        {bilevel && aggregate.ipapMedian != null && (
          <div className={styles.breakdownItem}>
            <span className={styles.breakdownLabel}>IPAP</span>
            <span className={styles.breakdownValue}>{fmt(aggregate.ipapMedian)}</span>
          </div>
        )}
        {bilevel && aggregate.pressureSupport != null && (
          <div className={styles.breakdownItem}>
            <span className={styles.breakdownLabel}>PS</span>
            <span className={styles.breakdownValue}>{fmt(aggregate.pressureSupport)}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

function SpO2Card({ aggregate }: { aggregate: NightlyAggregate }) {
  return (
    <Card className={styles.metricCard}>
      <div className={styles.metricCardHeader}>
        <h3 className={styles.metricCardTitle}>SpO₂</h3>
      </div>
      <div className={styles.metricPrimary}>
        <span className={styles.metricValue}>{fmt(aggregate.spo2Mean)}</span>
        <span className={styles.metricUnit}>% mean</span>
      </div>
      <div className={styles.metricBreakdown}>
        <div className={styles.breakdownItem}>
          <span className={styles.breakdownLabel}>Min</span>
          <span className={styles.breakdownValue}>{fmt(aggregate.spo2Min, 0)}</span>
        </div>
        <div className={styles.breakdownItem}>
          <span className={styles.breakdownLabel}>Time &lt;90%</span>
          <span className={styles.breakdownValue}>
            {aggregate.spo2Below90Percent != null
              ? `${formatMetric('spo2', aggregate.spo2Below90Percent)}%`
              : '—'}
          </span>
        </div>
        <div className={styles.breakdownItem}>
          <span className={styles.breakdownLabel}>ODI</span>
          <span className={styles.breakdownValue}>{fmt(aggregate.oxygenDesaturationIndex)}</span>
        </div>
        <div className={styles.breakdownItem}>
          <span className={styles.breakdownLabel}>Coverage</span>
          <span className={styles.breakdownValue}>
            {aggregate.spo2CoveragePercent != null
              ? `${aggregate.spo2CoveragePercent.toFixed(0)}%`
              : '—'}
          </span>
        </div>
      </div>
    </Card>
  );
}

// ── Loading Skeleton ─────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className={styles.loadingContainer} aria-busy="true">
      <div className={styles.skeletonHeader}>
        <Skeleton width="30%" height={16} variant="text" />
        <Skeleton width="50%" height={32} variant="text" />
        <Skeleton width="40%" height={16} variant="text" />
      </div>
      <div className={styles.skeletonMetrics}>
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i}>
            <div className={styles.skeletonCard}>
              <Skeleton width="40%" height={14} variant="text" />
              <Skeleton width="60%" height={36} variant="text" />
              <Skeleton width="100%" height={48} variant="rect" />
            </div>
          </Card>
        ))}
      </div>
      <Skeleton width="100%" height={48} variant="rect" />
      <Skeleton width="100%" height={200} variant="rect" />
    </div>
  );
}

// ── Error State ──────────────────────────────────────────────────

function ErrorState({ message }: { message: string }) {
  return (
    <div className={styles.errorState} role="alert">
      <span className={styles.errorIcon} aria-hidden="true">
        ⚠
      </span>
      <h2 className={styles.errorTitle}>Failed to load session</h2>
      <p className={styles.errorMessage}>{message}</p>
      <Button variant="secondary" onClick={() => window.history.back()}>
        Go back
      </Button>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────

export default function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const isChildRouteActive = useMatch('/sessions/:sessionId/signals');
  const navigate = useNavigate();

  const {
    session,
    aggregate,
    loading: sessionLoading,
    error: sessionError,
  } = useSessionDetail(sessionId);
  const { events, loading: eventsLoading, error: eventsError } = useEventData(sessionId);

  const sessionStartMs = useMemo(
    () => (session ? new Date(session.startTime).getTime() : 0),
    [session],
  );
  const sessionEndMs = useMemo(
    () => (session ? new Date(session.endTime).getTime() : 0),
    [session],
  );

  // ── Child route (Signal Viewer) ────────────────────────────────
  if (isChildRouteActive) {
    return <Outlet />;
  }

  // ── Loading state ──────────────────────────────────────────────
  if (sessionLoading || eventsLoading) {
    return <LoadingSkeleton />;
  }

  // ── Error state ────────────────────────────────────────────────
  const error = sessionError ?? eventsError;
  if (error) {
    return <ErrorState message={error} />;
  }

  // ── No data ────────────────────────────────────────────────────
  if (!session) {
    return <ErrorState message="Session not found." />;
  }

  return (
    <div className={styles.container}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <nav className={styles.breadcrumb} aria-label="Breadcrumb">
            <Link to="/sessions" className={styles.breadcrumbLink}>
              Sessions
            </Link>
            <span className={styles.breadcrumbSep} aria-hidden="true">
              /
            </span>
            <span>{session.date}</span>
          </nav>
          <h1 className={styles.title}>{formatDate(session.date)}</h1>
          <div className={styles.headerMeta}>
            <span>{session.machineModel}</span>
            <span className={styles.metaDivider} aria-hidden="true" />
            <Badge variant="info" size="sm">
              {MACHINE_TYPE_LABELS[session.machineType]}
            </Badge>
            <span className={styles.metaDivider} aria-hidden="true" />
            <span>Duration: {formatDuration(session.durationMinutes)}</span>
            <span className={styles.metaDivider} aria-hidden="true" />
            <span>Mask-on: {formatDuration(session.usageMinutes)}</span>
          </div>
        </div>
        <div className={styles.headerActions}>
          <Button variant="primary" onClick={() => navigate(`/sessions/${session.id}/signals`)}>
            View Signals
          </Button>
        </div>
      </header>

      {/* ── Key Metrics ─────────────────────────────────────────── */}
      {aggregate && (
        <section className={styles.metricsGrid} aria-label="Key therapy metrics">
          <AHICard aggregate={aggregate} />
          <LeakCard aggregate={aggregate} />
          <PressureCard aggregate={aggregate} machineType={session.machineType} />
          {session.hasOximetry && <SpO2Card aggregate={aggregate} />}
        </section>
      )}

      {/* ── Event Timeline ──────────────────────────────────────── */}
      {events.length > 0 && (
        <EventTimeline events={events} sessionStart={sessionStartMs} sessionEnd={sessionEndMs} />
      )}

      {/* ── Event Summary Table ─────────────────────────────────── */}
      {events.length > 0 && <EventSummaryTable events={events} />}
    </div>
  );
}
