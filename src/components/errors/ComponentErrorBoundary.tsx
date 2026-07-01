import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import styles from './ComponentErrorBoundary.module.css';

interface ComponentErrorBoundaryProps {
  children: ReactNode;
  /** Optional custom fallback UI. When omitted, a compact default indicator is shown. */
  fallback?: ReactNode;
}

interface ComponentErrorBoundaryState {
  hasError: boolean;
}

/**
 * Widget-level error boundary for individual components or cards.
 *
 * Renders a compact error indicator with a retry button.
 * Accepts an optional `fallback` prop for custom fallback UI.
 */
export class ComponentErrorBoundary extends Component<
  ComponentErrorBoundaryProps,
  ComponentErrorBoundaryState
> {
  constructor(props: ComponentErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ComponentErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // eslint-disable-next-line no-console -- intentional error-boundary logging; stays in-browser (no telemetry)
    console.error('[ComponentErrorBoundary] Uncaught error:', error, errorInfo);
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }

      return (
        <div className={styles.container} role="alert">
          <span>Something went wrong</span>
          <button className={styles.retryButton} onClick={this.handleRetry} type="button">
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
