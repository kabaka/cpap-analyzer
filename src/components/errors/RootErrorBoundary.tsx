import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import styles from './RootErrorBoundary.module.css';

interface RootErrorBoundaryProps {
  children: ReactNode;
}

interface RootErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Top-level error boundary that catches fatal application errors.
 *
 * Renders a full-page error screen with a reload button.
 * This should wrap the entire application to ensure no uncaught
 * errors result in a blank screen.
 */
export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  constructor(props: RootErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log to console in development; a future telemetry-free logging
    // system could hook in here.
    // eslint-disable-next-line no-console -- intentional error-boundary logging; stays in-browser (no telemetry)
    console.error('[RootErrorBoundary] Uncaught error:', error, errorInfo);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className={styles.container} role="alert">
          <svg
            className={styles.icon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <h1 className={styles.heading}>Something went wrong</h1>
          <p className={styles.message}>
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          <button className={styles.reloadButton} onClick={this.handleReload} type="button">
            Reload Application
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
