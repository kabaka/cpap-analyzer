import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import styles from './RouteErrorBoundary.module.css';

interface RouteErrorBoundaryProps {
  children: ReactNode;
  /** When any value in this array changes, the boundary resets itself. */
  resetKeys?: readonly unknown[];
}

interface RouteErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Route-level error boundary that catches errors within a view.
 *
 * Renders an error panel inside the existing layout chrome.
 * Supports `resetKeys` — when the keys change (e.g. on route navigation)
 * the boundary automatically resets.
 */
export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  constructor(props: RouteErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // eslint-disable-next-line no-console -- intentional error-boundary logging; stays in-browser (no telemetry)
    console.error('[RouteErrorBoundary] Uncaught error:', error, errorInfo);
  }

  componentDidUpdate(prevProps: Readonly<RouteErrorBoundaryProps>): void {
    if (!this.state.hasError) return;

    const prevKeys = prevProps.resetKeys ?? [];
    const nextKeys = this.props.resetKeys ?? [];

    const changed =
      prevKeys.length !== nextKeys.length || prevKeys.some((key, i) => key !== nextKeys[i]);

    if (changed) {
      this.setState({ hasError: false, error: null });
    }
  }

  private handleGoToDashboard = (): void => {
    // Use direct assignment instead of React Router hooks because
    // hooks are unavailable inside a class component error state.
    window.location.href = '/';
  };

  private handleTryAgain = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className={styles.panel} role="alert">
          <h2 className={styles.heading}>This view encountered an error</h2>
          <p className={styles.message}>
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          <div className={styles.actions}>
            <button
              className={styles.buttonPrimary}
              onClick={this.handleGoToDashboard}
              type="button"
            >
              Go to Dashboard
            </button>
            <button className={styles.buttonSecondary} onClick={this.handleTryAgain} type="button">
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
