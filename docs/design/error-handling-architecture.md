# Error Handling and Recovery Architecture — CPAP Analyzer

**Version**: 1.0  
**Last Updated**: February 10, 2026  
**Status**: Architecture Decision Record  
**Audience**: Frontend Agent, QA, Security, All Implementation Specialists

## Executive Summary

This document defines the unified error handling and recovery architecture for CPAP Analyzer, establishing patterns for error detection, classification, propagation, user communication, and recovery across all application layers. The architecture prioritizes **clear user feedback**, **graceful degradation**, **privacy-safe error logging**, and **system resilience** while maintaining the application's client-side-only constraint.

This document addresses **QA GAP-1 (BLOCKER)**: the absence of a unified error handling strategy across component error handling, state management, worker operations, and user-facing error experiences.

### Key Architectural Decisions

- **Error Taxonomy**: Five-category classification system (User, System, Data, Network, Worker)
- **React Error Boundaries**: Three-tier boundary strategy (root, route, component) with typed fallback components
- **Zustand Error State**: Standardized error state pattern across all stores with optimistic update rollback
- **Worker Error Marshalling**: Structured error serialization for cross-thread communication
- **User-Facing Messages**: Severity-based message templates with actionable recovery steps
- **Recovery Workflows**: Automated retry logic, partial success handling, and user-guided recovery paths
- **Privacy-Safe Logging**: PHI-stripped error logs with export capability for debugging

### Core Principles

1. **Fail Gracefully**: No catastrophic application crashes; always provide a recovery path
2. **Be Specific**: Generic "Something went wrong" messages are prohibited; always provide context
3. **Privacy First**: Error logs never contain PHI (Protected Health Information) or session data
4. **User Agency**: Always offer actionable next steps; never leave users stranded
5. **Progressive Enhancement**: Feature detection and graceful degradation for browser compatibility

---

## 1. Error Types Taxonomy

### 1.1 Error Classification System

All errors in CPAP Analyzer are classified into five categories. This taxonomy informs error handling strategy, user messaging, recovery options, and logging.

```typescript
/**
 * Error category taxonomy for CPAP Analyzer
 */
export enum ErrorCategory {
  /** User-triggered errors (invalid input, missing data selection) */
  USER = 'USER',
  
  /** System-level errors (storage quota, browser compatibility, permissions) */
  SYSTEM = 'SYSTEM',
  
  /** Data integrity errors (corrupted files, parse failures, schema violations) */
  DATA = 'DATA',
  
  /** Network-related errors (plugin integrations, external API calls only) */
  NETWORK = 'NETWORK',
  
  /** Web Worker errors (computation failures, timeouts, OOM) */
  WORKER = 'WORKER',
}

/**
 * Severity levels for error presentation and logging
 */
export enum ErrorSeverity {
  /** Fatal: Application cannot continue, requires reload or data re-import */
  FATAL = 'FATAL',
  
  /** Error: Operation failed, but application is stable */
  ERROR = 'ERROR',
  
  /** Warning: Operation completed with caveats */
  WARNING = 'WARNING',
  
  /** Info: Non-critical issue that user should be aware of */
  INFO = 'INFO',
}

/**
 * Base error structure for all CPAP Analyzer errors
 */
export interface CPAPError {
  /** Unique error identifier for tracking and logging */
  id: string;
  
  /** Error category */
  category: ErrorCategory;
  
  /** Severity level */
  severity: ErrorSeverity;
  
  /** Short error title (user-facing) */
  title: string;
  
  /** Detailed error message (user-facing) */
  message: string;
  
  /** Actionable recovery steps for the user */
  recoverySteps?: string[];
  
  /** Technical details (for logging and debugging, not shown to users) */
  technicalDetails?: {
    originalError?: Error;
    stack?: string;
    context?: Record<string, unknown>;
  };
  
  /** Timestamp when error occurred */
  timestamp: Date;
  
  /** Optional retry handler */
  retry?: () => Promise<void>;
}
```

### 1.2 Category Definitions and Examples

#### 1.2.1 User Errors (ErrorCategory.USER)

**Definition**: Errors caused by invalid user input or incomplete user actions.

**Characteristics**:
- Preventable with proper validation and UI constraints
- Typically non-fatal (severity: WARNING or INFO)
- Require user action to resolve

**Examples**:
- User attempts to run analysis without selecting sessions
- User enters invalid date range (end date before start date)
- User attempts to export data when no data is selected
- User selects incompatible analysis parameters

**Handling Strategy**:
- Show inline validation messages before submission when possible
- Use Toast notifications for post-submission validation
- Highlight specific form fields or UI elements that need attention
- Provide clear guidance on what valid input looks like

**Code Example**:
```typescript
// Example: Session selection validation
function validateSessionSelection(selectedIds: string[]): CPAPError | null {
  if (selectedIds.length === 0) {
    return {
      id: crypto.randomUUID(),
      category: ErrorCategory.USER,
      severity: ErrorSeverity.WARNING,
      title: 'No Sessions Selected',
      message: 'Please select at least one session to run this analysis.',
      recoverySteps: [
        'Select one or more sessions from the table',
        'Use the date range picker to filter sessions',
        'Use "Select All" to include all sessions in the current view',
      ],
      timestamp: new Date(),
    };
  }
  return null;
}
```

#### 1.2.2 System Errors (ErrorCategory.SYSTEM)

**Definition**: Errors originating from browser capabilities, storage limits, or system-level permissions.

**Characteristics**:
- Often fatal or require significant user intervention
- May indicate browser incompatibility or resource exhaustion
- Require system-level recovery (free storage, update browser, grant permissions)

**Examples**:
- IndexedDB quota exceeded
- OPFS not available (browser compatibility)
- `requestIdleCallback` not supported
- Web Worker instantiation failed
- Service Worker registration failed

**Handling Strategy**:
- Feature detection BEFORE attempting operations
- Graceful degradation to fallback implementations
- Clear communication about browser requirements
- Provide storage management UI when quota is approached

**Code Example**:
```typescript
// Example: Storage quota detection and handling
async function checkStorageQuota(): Promise<CPAPError | null> {
  if (!navigator.storage?.estimate) {
    return {
      id: crypto.randomUUID(),
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      title: 'Storage API Not Supported',
      message: 'Your browser does not support storage quota checking. Some features may not work correctly.',
      recoverySteps: [
        'Update to a modern browser (Chrome 84+, Firefox 87+, Safari 15.2+)',
        'Continue with limited functionality',
      ],
      timestamp: new Date(),
    };
  }

  const estimate = await navigator.storage.estimate();
  const usagePercent = (estimate.usage! / estimate.quota!) * 100;

  if (usagePercent > 90) {
    return {
      id: crypto.randomUUID(),
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.ERROR,
      title: 'Storage Nearly Full',
      message: `You are using ${usagePercent.toFixed(1)}% of available storage. Import may fail.`,
      recoverySteps: [
        'Delete old sessions from Data Management',
        'Clear browser cache and site data',
        'Free up disk space on your device',
      ],
      timestamp: new Date(),
    };
  }

  return null;
}
```

#### 1.2.3 Data Errors (ErrorCategory.DATA)

**Definition**: Errors related to data integrity, file parsing, or schema validation.

**Characteristics**:
- Can be fatal to specific operations but not entire application
- May indicate corrupted files, unsupported formats, or schema changes
- Often recoverable through re-import or data cleanup

**Examples**:
- EDF file header checksum mismatch
- Unrecognized ResMed data format version
- Missing required EDF signals
- Invalid timestamp sequences
- Corrupted signal data (NaN values, out-of-range values)

**Handling Strategy**:
- Validate file structure before full parsing
- Support partial imports (skip corrupted records)
- Provide detailed validation reports
- Offer data repair tools where appropriate

**Code Example**:
```typescript
// Example: EDF parsing error with partial recovery
interface EDFParseResult {
  success: boolean;
  data?: EDFData;
  error?: CPAPError;
  partialData?: Partial<EDFData>;
}

async function parseEDFFile(file: File): Promise<EDFParseResult> {
  try {
    const buffer = await file.arrayBuffer();
    const header = parseEDFHeader(buffer);
    
    // Validate header
    if (!header.isValid) {
      return {
        success: false,
        error: {
          id: crypto.randomUUID(),
          category: ErrorCategory.DATA,
          severity: ErrorSeverity.ERROR,
          title: 'Invalid EDF File Header',
          message: `The file "${file.name}" does not appear to be a valid EDF file.`,
          recoverySteps: [
            'Verify the file is from your CPAP machine SD card',
            'Try re-exporting the file from your CPAP machine',
            'Check if the file was corrupted during transfer',
          ],
          technicalDetails: {
            context: {
              fileName: file.name,
              fileSize: file.size,
              expectedMagicBytes: '0       ',
              actualMagicBytes: header.magicBytes,
            },
          },
          timestamp: new Date(),
        },
      };
    }

    // Parse signals with error tolerance
    const signals = parseEDFSignals(buffer, header);
    
    if (signals.errors.length > 0) {
      // Partial success: some signals parsed, some failed
      return {
        success: true,
        data: {
          header,
          signals: signals.validSignals,
        },
        error: {
          id: crypto.randomUUID(),
          category: ErrorCategory.DATA,
          severity: ErrorSeverity.WARNING,
          title: 'Partial Import Completed',
          message: `Imported ${signals.validSignals.length} of ${header.signalCount} signals. ${signals.errors.length} signals could not be parsed.`,
          recoverySteps: [
            'Review the partial data to see if it meets your needs',
            'Try re-importing the file',
            'Contact support with technical details if issue persists',
          ],
          technicalDetails: {
            context: {
              fileName: file.name,
              validSignals: signals.validSignals.map(s => s.label),
              failedSignals: signals.errors.map(e => e.signalLabel),
            },
          },
          timestamp: new Date(),
        },
      };
    }

    return {
      success: true,
      data: { header, signals: signals.validSignals },
    };

  } catch (error) {
    return {
      success: false,
      error: {
        id: crypto.randomUUID(),
        category: ErrorCategory.DATA,
        severity: ErrorSeverity.FATAL,
        title: 'Import Failed',
        message: `Unable to import "${file.name}". The file may be corrupted or in an unsupported format.`,
        recoverySteps: [
          'Verify the file is from a supported CPAP machine (currently: ResMed AirSense 10/11)',
          'Check file integrity (re-copy from SD card)',
          'Try importing a different file',
        ],
        technicalDetails: {
          originalError: error as Error,
          context: {
            fileName: file.name,
            fileSize: file.size,
          },
        },
        timestamp: new Date(),
      },
    };
  }
}
```

#### 1.2.4 Network Errors (ErrorCategory.NETWORK)

**Definition**: Errors related to network requests (plugin integrations ONLY; core app is offline-first).

**Characteristics**:
- Only relevant for optional plugin features (Fitbit sync, LLM integrations)
- Should never block core functionality
- Often transient and retryable

**Examples**:
- Fitbit API authentication failure
- LLM API timeout
- CORS policy rejection
- Network connectivity lost during plugin sync

**Handling Strategy**:
- Make all network features explicitly opt-in
- Show clear "online required" indicators
- Implement exponential backoff retry logic
- Provide offline fallback where possible
- Never fail core operations due to plugin network errors

**Code Example**:
```typescript
// Example: Plugin API call with retry logic
interface NetworkRequestOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  timeout?: number;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit & NetworkRequestOptions = {}
): Promise<Response> {
  const {
    maxRetries = 3,
    retryDelayMs = 1000,
    timeout = 10000,
    ...fetchOptions
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;

    } catch (error) {
      lastError = error as Error;

      if (attempt < maxRetries) {
        // Exponential backoff
        await new Promise(resolve =>
          setTimeout(resolve, retryDelayMs * Math.pow(2, attempt))
        );
        continue;
      }
    }
  }

  // All retries exhausted
  throw {
    id: crypto.randomUUID(),
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.ERROR,
    title: 'Network Request Failed',
    message: 'Unable to connect to external service. Please check your internet connection.',
    recoverySteps: [
      'Check your internet connection',
      'Try again in a few moments',
      'Disable VPN or proxy if active',
      'Continue using the app without this integration',
    ],
    technicalDetails: {
      originalError: lastError!,
      context: {
        url,
        attempts: maxRetries + 1,
      },
    },
    timestamp: new Date(),
    retry: () => fetchWithRetry(url, options),
  } as CPAPError;
}
```

#### 1.2.5 Worker Errors (ErrorCategory.WORKER)

**Definition**: Errors occurring in Web Workers during heavy computation.

**Characteristics**:
- Can be fatal to specific analysis operations
- May indicate timeout, OOM, or computation errors
- Require main thread intervention for recovery

**Examples**:
- Worker script failed to load
- Computation timeout exceeded
- Worker out-of-memory (OOM)
- Unhandled exception in worker thread
- Worker-main thread communication failure

**Handling Strategy**:
- Set reasonable timeout limits for all worker operations
- Implement worker health checks
- Provide progress updates for long-running operations
- Allow user cancellation of worker operations
- Restart workers on fatal errors

**Code Example** (see section 4 for full implementation):
```typescript
// Example: Worker timeout handling
async function executeInWorker<T>(
  worker: Worker,
  operation: string,
  data: unknown,
  timeoutMs: number = 30000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject({
        id: crypto.randomUUID(),
        category: ErrorCategory.WORKER,
        severity: ErrorSeverity.ERROR,
        title: 'Operation Timeout',
        message: `The ${operation} operation took too long to complete and was cancelled.`,
        recoverySteps: [
          'Try reducing the data range or complexity',
          'Close other browser tabs to free up memory',
          'Try again later',
        ],
        technicalDetails: {
          context: {
            operation,
            timeoutMs,
          },
        },
        timestamp: new Date(),
      } as CPAPError);
    }, timeoutMs);

    worker.onmessage = (event) => {
      clearTimeout(timeoutId);
      if (event.data.error) {
        reject(deserializeWorkerError(event.data.error));
      } else {
        resolve(event.data.result);
      }
    };

    worker.onerror = (event) => {
      clearTimeout(timeoutId);
      reject({
        id: crypto.randomUUID(),
        category: ErrorCategory.WORKER,
        severity: ErrorSeverity.FATAL,
        title: 'Worker Crashed',
        message: 'A background computation process crashed unexpectedly.',
        recoverySteps: [
          'Reload the application',
          'Try the operation again with different parameters',
          'Report this issue if it persists',
        ],
        technicalDetails: {
          context: {
            operation,
            errorMessage: event.message,
            filename: event.filename,
            lineno: event.lineno,
          },
        },
        timestamp: new Date(),
      } as CPAPError);
    };

    worker.postMessage({ operation, data });
  });
}
```

---

## 2. Global Error Boundary Strategy (React)

### 2.1 Three-Tier Boundary Architecture

CPAP Analyzer implements a three-tier error boundary strategy to maximize resilience while providing granular recovery options.

```
┌─────────────────────────────────────────────────────────────┐
│ Root Error Boundary (App.tsx)                               │
│ Catches all unhandled errors                                │
│ Fallback: Full-page error with reload/clear data options    │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ Route Error Boundaries (per major route)                    │
│ Dashboard / Sessions / Analysis / Reports / Settings        │
│ Fallback: Route-specific error with navigation options      │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ Component Error Boundaries (critical features)              │
│ SignalViewer / AnalysisPanel / ImportWizard                 │
│ Fallback: Component-specific error with retry option        │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Root-Level Error Boundary

**Purpose**: Catch all unhandled errors that propagate to the top of the component tree. This is the last line of defense against white-screen crashes.

**Fallback UI**: Full-page error message with options to reload or clear application data.

**Implementation**:
```typescript
// src/components/error-boundaries/RootErrorBoundary.tsx
import React, { Component, ReactNode } from 'react';
import { CPAPError, ErrorCategory, ErrorSeverity } from '@/types/errors';
import { ErrorFallback } from './ErrorFallback';

interface Props {
  children: ReactNode;
}

interface State {
  error: CPAPError | null;
  errorInfo: React.ErrorInfo | null;
}

export class RootErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Convert Error to CPAPError
    return {
      error: {
        id: crypto.randomUUID(),
        category: ErrorCategory.SYSTEM,
        severity: ErrorSeverity.FATAL,
        title: 'Application Error',
        message: 'An unexpected error occurred. The application needs to reload.',
        recoverySteps: [
          'Click "Reload Application" to restart',
          'If the error persists, click "Clear Data and Reload"',
          'If you continue to see this error, your browser may not be compatible',
        ],
        technicalDetails: {
          originalError: error,
          stack: error.stack,
        },
        timestamp: new Date(),
      },
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log error to console for debugging
    console.error('Root boundary caught error:', error, errorInfo);

    // Store error info for technical details
    this.setState(prevState => ({
      errorInfo,
      error: prevState.error
        ? {
            ...prevState.error,
            technicalDetails: {
              ...prevState.error.technicalDetails,
              componentStack: errorInfo.componentStack,
            },
          }
        : null,
    }));

    // Optional: Log to privacy-safe error storage
    // logErrorToStorage(error, errorInfo);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleClearDataAndReload = async (): Promise<void> => {
    try {
      // Clear IndexedDB
      const databases = await indexedDB.databases();
      await Promise.all(
        databases.map(db => {
          if (db.name) {
            return new Promise<void>((resolve, reject) => {
              const request = indexedDB.deleteDatabase(db.name!);
              request.onsuccess = () => resolve();
              request.onerror = () => reject(request.error);
            });
          }
        })
      );

      // Clear localStorage
      localStorage.clear();

      // Clear sessionStorage
      sessionStorage.clear();

      // Reload
      window.location.reload();
    } catch (error) {
      console.error('Failed to clear data:', error);
      // Force reload anyway
      window.location.reload();
    }
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <ErrorFallback
          error={this.state.error}
          onReload={this.handleReload}
          onClearData={this.handleClearDataAndReload}
          showTechnicalDetails={true}
        />
      );
    }

    return this.props.children;
  }
}
```

### 2.3 Route-Level Error Boundaries

**Purpose**: Isolate errors to specific routes so users can navigate away from problematic views without full app reload.

**Fallback UI**: Route-specific error message with navigation options to other routes.

**Implementation**:
```typescript
// src/components/error-boundaries/RouteErrorBoundary.tsx
import React, { Component, ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { CPAPError, ErrorCategory, ErrorSeverity } from '@/types/errors';
import { ErrorFallback } from './ErrorFallback';

interface Props {
  children: ReactNode;
  routeName: string;
  fallbackRoute?: string;
}

interface State {
  error: CPAPError | null;
}

class RouteErrorBoundaryClass extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      error: {
        id: crypto.randomUUID(),
        category: ErrorCategory.SYSTEM,
        severity: ErrorSeverity.ERROR,
        title: 'Page Error',
        message: 'This page encountered an error and cannot be displayed.',
        recoverySteps: [
          'Navigate to another section using the menu',
          'Return to Dashboard',
          'Reload this page',
        ],
        technicalDetails: {
          originalError: error,
        },
        timestamp: new Date(),
      },
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(`Route boundary (${this.props.routeName}) caught error:`, error, errorInfo);
  }

  componentDidUpdate(prevProps: Props): void {
    // Reset error boundary when route changes
    if (prevProps.routeName !== this.props.routeName && this.state.error) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <ErrorFallback
          error={this.state.error}
          routeName={this.props.routeName}
          fallbackRoute={this.props.fallbackRoute}
          showTechnicalDetails={false}
        />
      );
    }

    return this.props.children;
  }
}

// HOC to inject router props
export function RouteErrorBoundary(props: Omit<Props, 'navigate' | 'location'>) {
  return <RouteErrorBoundaryClass {...props} />;
}
```

**Usage in Routes**:
```typescript
// src/App.tsx
import { RouteErrorBoundary } from '@/components/error-boundaries/RouteErrorBoundary';

function App() {
  return (
    <Routes>
      <Route
        path="/dashboard"
        element={
          <RouteErrorBoundary routeName="Dashboard" fallbackRoute="/">
            <Dashboard />
          </RouteErrorBoundary>
        }
      />
      <Route
        path="/sessions/:sessionId"
        element={
          <RouteErrorBoundary routeName="Session Detail" fallbackRoute="/dashboard">
            <SessionDetail />
          </RouteErrorBoundary>
        }
      />
      {/* More routes... */}
    </Routes>
  );
}
```

### 2.4 Component-Level Error Boundaries

**Purpose**: Isolate errors to specific critical components, allowing the rest of the page to remain functional.

**Target Components**:
- `SignalViewer` (rendering 25–50 Hz time-series data)
- `AnalysisPanel` (complex statistical computations)
- `ImportWizard` (file parsing and validation)
- `ChartRenderer` (data visualization)

**Fallback UI**: Inline error message within component bounds with retry button.

**Implementation**:
```typescript
// src/components/error-boundaries/ComponentErrorBoundary.tsx
import React, { Component, ReactNode } from 'react';
import { CPAPError, ErrorCategory, ErrorSeverity } from '@/types/errors';
import { ErrorMessage } from '@/components/ui/ErrorMessage';

interface Props {
  children: ReactNode;
  componentName: string;
  onError?: (error: CPAPError) => void;
  fallback?: (error: CPAPError, retry: () => void) => ReactNode;
}

interface State {
  error: CPAPError | null;
  resetKey: number;
}

export class ComponentErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      error: null,
      resetKey: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      error: {
        id: crypto.randomUUID(),
        category: ErrorCategory.SYSTEM,
        severity: ErrorSeverity.ERROR,
        title: 'Component Error',
        message: 'This component encountered an error and cannot be displayed.',
        recoverySteps: ['Try reloading this component', 'Refresh the page'],
        technicalDetails: {
          originalError: error,
        },
        timestamp: new Date(),
      },
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(`Component boundary (${this.props.componentName}) caught error:`, error, errorInfo);

    if (this.props.onError && this.state.error) {
      this.props.onError(this.state.error);
    }
  }

  handleRetry = (): void => {
    this.setState(prevState => ({
      error: null,
      resetKey: prevState.resetKey + 1,
    }));
  };

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleRetry);
      }

      return (
        <ErrorMessage
          error={this.state.error}
          onRetry={this.handleRetry}
          compact={true}
        />
      );
    }

    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}
```

**Usage Example**:
```typescript
// src/pages/SessionDetail.tsx
import { ComponentErrorBoundary } from '@/components/error-boundaries/ComponentErrorBoundary';

function SessionDetail() {
  return (
    <div className="session-detail">
      <SessionHeader />
      
      <ComponentErrorBoundary
        componentName="SignalViewer"
        fallback={(error, retry) => (
          <div className="signal-viewer-error">
            <h3>{error.title}</h3>
            <p>{error.message}</p>
            <Button onClick={retry}>Retry</Button>
            <Button variant="secondary" onClick={() => navigateTo('/dashboard')}>
              Return to Dashboard
            </Button>
          </div>
        )}
      >
        <SignalViewer sessionId={sessionId} />
      </ComponentErrorBoundary>

      <SessionStatistics />
    </div>
  );
}
```

### 2.5 Error Fallback Component

**Shared fallback component for consistent error presentation**:

```typescript
// src/components/error-boundaries/ErrorFallback.tsx
import React from 'react';
import { CPAPError } from '@/types/errors';
import { Button } from '@/components/ui/Button';
import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ErrorFallbackProps {
  error: CPAPError;
  onReload?: () => void;
  onClearData?: () => void;
  routeName?: string;
  fallbackRoute?: string;
  showTechnicalDetails?: boolean;
}

export function ErrorFallback({
  error,
  onReload,
  onClearData,
  routeName,
  fallbackRoute = '/dashboard',
  showTechnicalDetails = false,
}: ErrorFallbackProps) {
  const navigate = useNavigate();
  const [showDetails, setShowDetails] = React.useState(false);

  return (
    <div className="error-fallback">
      <div className="error-fallback__icon">
        <AlertTriangle size={48} />
      </div>

      <h1 className="error-fallback__title">{error.title}</h1>
      <p className="error-fallback__message">{error.message}</p>

      {error.recoverySteps && error.recoverySteps.length > 0 && (
        <div className="error-fallback__recovery">
          <h2>What can I do?</h2>
          <ol>
            {error.recoverySteps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      <div className="error-fallback__actions">
        {onReload && (
          <Button onClick={onReload} variant="primary">
            <RefreshCw size={16} />
            Reload Application
          </Button>
        )}

        {fallbackRoute && (
          <Button onClick={() => navigate(fallbackRoute)} variant="secondary">
            Go to Dashboard
          </Button>
        )}

        {onClearData && (
          <Button onClick={onClearData} variant="danger">
            <Trash2 size={16} />
            Clear Data and Reload
          </Button>
        )}

        {error.retry && (
          <Button onClick={error.retry} variant="secondary">
            <RefreshCw size={16} />
            Try Again
          </Button>
        )}
      </div>

      {showTechnicalDetails && error.technicalDetails && (
        <details className="error-fallback__technical">
          <summary onClick={() => setShowDetails(!showDetails)}>
            Technical Details
          </summary>
          {showDetails && (
            <pre>
              <code>
                {JSON.stringify(
                  {
                    id: error.id,
                    category: error.category,
                    severity: error.severity,
                    timestamp: error.timestamp,
                    ...error.technicalDetails,
                  },
                  null,
                  2
                )}
              </code>
            </pre>
          )}
        </details>
      )}
    </div>
  );
}
```

---

## 3. Zustand Error State Patterns

### 3.1 Standardized Error State Structure

All Zustand stores follow a consistent pattern for error state management:

```typescript
// src/types/store.ts
import { CPAPError } from './errors';

/**
 * Standard error state pattern for Zustand stores
 */
export interface ErrorState {
  /** Current error, if any */
  error: CPAPError | null;

  /** Loading state (distinct from error state) */
  isLoading: boolean;

  /** Timestamp of last error (for retry debouncing) */
  lastErrorTime: Date | null;

  /** Number of consecutive errors (for exponential backoff) */
  errorCount: number;
}

/**
 * Standard error actions for Zustand stores
 */
export interface ErrorActions {
  /** Set error state */
  setError: (error: CPAPError) => void;

  /** Clear error state */
  clearError: () => void;

  /** Increment error count (for retry logic) */
  incrementErrorCount: () => void;

  /** Reset error count (on successful operation) */
  resetErrorCount: () => void;
}
```

### 3.2 Example Store with Error Handling

```typescript
// src/stores/sessionStore.ts
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { CPAPError, ErrorCategory, ErrorSeverity } from '@/types/errors';
import { ErrorState, ErrorActions } from '@/types/store';

interface Session {
  id: string;
  date: Date;
  // ... other fields
}

interface SessionState extends ErrorState {
  sessions: Session[];
  selectedSessionIds: string[];
  isImporting: boolean;
}

interface SessionActions extends ErrorActions {
  importSessions: (files: File[]) => Promise<void>;
  selectSession: (id: string) => void;
  deselectSession: (id: string) => void;
  deleteSession: (id: string) => Promise<void>;
}

type SessionStore = SessionState & SessionActions;

export const useSessionStore = create<SessionStore>()(
  immer((set, get) => ({
    // State
    sessions: [],
    selectedSessionIds: [],
    isImporting: false,
    error: null,
    isLoading: false,
    lastErrorTime: null,
    errorCount: 0,

    // Error actions
    setError: (error: CPAPError) => {
      set(state => {
        state.error = error;
        state.lastErrorTime = new Date();
        state.errorCount += 1;
      });
    },

    clearError: () => {
      set(state => {
        state.error = null;
      });
    },

    incrementErrorCount: () => {
      set(state => {
        state.errorCount += 1;
      });
    },

    resetErrorCount: () => {
      set(state => {
        state.errorCount = 0;
      });
    },

    // Business logic with error handling
    importSessions: async (files: File[]) => {
      const { setError, clearError, resetErrorCount } = get();

      set(state => {
        state.isImporting = true;
        state.isLoading = true;
        state.error = null;
      });

      try {
        // Import logic here...
        const importedSessions = await importSessionFiles(files);

        set(state => {
          state.sessions.push(...importedSessions);
          state.isImporting = false;
          state.isLoading = false;
        });

        resetErrorCount();

      } catch (error) {
        const cpapError: CPAPError = {
          id: crypto.randomUUID(),
          category: ErrorCategory.DATA,
          severity: ErrorSeverity.ERROR,
          title: 'Import Failed',
          message: `Failed to import ${files.length} file(s). ${(error as Error).message}`,
          recoverySteps: [
            'Verify files are from your CPAP machine SD card',
            'Try importing files one at a time',
            'Check if files were corrupted during transfer',
          ],
          technicalDetails: {
            originalError: error as Error,
            context: {
              fileCount: files.length,
              fileNames: files.map(f => f.name),
            },
          },
          timestamp: new Date(),
          retry: () => get().importSessions(files),
        };

        setError(cpapError);

        set(state => {
          state.isImporting = false;
          state.isLoading = false;
        });
      }
    },

    selectSession: (id: string) => {
      set(state => {
        if (!state.selectedSessionIds.includes(id)) {
          state.selectedSessionIds.push(id);
        }
      });
    },

    deselectSession: (id: string) => {
      set(state => {
        state.selectedSessionIds = state.selectedSessionIds.filter(
          sessionId => sessionId !== id
        );
      });
    },

    deleteSession: async (id: string) => {
      const { setError, clearError } = get();

      set(state => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        await deleteSessionFromStorage(id);

        set(state => {
          state.sessions = state.sessions.filter(s => s.id !== id);
          state.selectedSessionIds = state.selectedSessionIds.filter(
            sessionId => sessionId !== id
          );
          state.isLoading = false;
        });

      } catch (error) {
        const cpapError: CPAPError = {
          id: crypto.randomUUID(),
          category: ErrorCategory.SYSTEM,
          severity: ErrorSeverity.ERROR,
          title: 'Delete Failed',
          message: 'Unable to delete session. Storage may be locked.',
          recoverySteps: [
            'Close other tabs with CPAP Analyzer open',
            'Try again in a few moments',
            'Reload the application',
          ],
          technicalDetails: {
            originalError: error as Error,
            context: { sessionId: id },
          },
          timestamp: new Date(),
          retry: () => get().deleteSession(id),
        };

        setError(cpapError);

        set(state => {
          state.isLoading = false;
        });
      }
    },
  }))
);
```

### 3.3 Optimistic Updates with Rollback

For operations that benefit from optimistic UI updates (e.g., selection, annotation), implement rollback on error:

```typescript
// Example: Optimistic annotation with rollback
interface Annotation {
  id: string;
  sessionId: string;
  timestamp: number;
  content: string;
}

interface AnnotationStore {
  annotations: Annotation[];
  addAnnotation: (annotation: Omit<Annotation, 'id'>) => Promise<void>;
}

export const useAnnotationStore = create<AnnotationStore>()(
  immer((set, get) => ({
    annotations: [],

    addAnnotation: async (annotation: Omit<Annotation, 'id'>) => {
      const optimisticId = crypto.randomUUID();
      const optimisticAnnotation: Annotation = {
        ...annotation,
        id: optimisticId,
      };

      // Optimistic update
      set(state => {
        state.annotations.push(optimisticAnnotation);
      });

      try {
        // Persist to IndexedDB
        const persistedId = await saveAnnotationToStorage(annotation);

        // Update with real ID
        set(state => {
          const index = state.annotations.findIndex(a => a.id === optimisticId);
          if (index !== -1) {
            state.annotations[index].id = persistedId;
          }
        });

      } catch (error) {
        // Rollback on error
        set(state => {
          state.annotations = state.annotations.filter(
            a => a.id !== optimisticId
          );
        });

        // Show error to user
        const cpapError: CPAPError = {
          id: crypto.randomUUID(),
          category: ErrorCategory.SYSTEM,
          severity: ErrorSeverity.ERROR,
          title: 'Save Failed',
          message: 'Your annotation could not be saved.',
          recoverySteps: [
            'Try adding the annotation again',
            'Check available storage space',
          ],
          technicalDetails: {
            originalError: error as Error,
          },
          timestamp: new Date(),
        };

        // Propagate to UI error handler
        useUIStore.getState().setError(cpapError);
      }
    },
  }))
);
```

### 3.4 Error Propagation Between Stores

When operations span multiple stores, errors should be propagated to a global UI store for display:

```typescript
// src/stores/uiStore.ts
import { create } from 'zustand';
import { CPAPError } from '@/types/errors';

interface Toast {
  id: string;
  error: CPAPError;
  isVisible: boolean;
}

interface UIStore {
  toasts: Toast[];
  addToast: (error: CPAPError) => void;
  dismissToast: (id: string) => void;
  setError: (error: CPAPError) => void; // Convenience method
}

export const useUIStore = create<UIStore>((set) => ({
  toasts: [],

  addToast: (error: CPAPError) => {
    set(state => ({
      toasts: [
        ...state.toasts,
        {
          id: error.id,
          error,
          isVisible: true,
        },
      ],
    }));

    // Auto-dismiss non-fatal errors after 10 seconds
    if (error.severity !== 'FATAL') {
      setTimeout(() => {
        set(state => ({
          toasts: state.toasts.map(toast =>
            toast.id === error.id ? { ...toast, isVisible: false } : toast
          ),
        }));
      }, 10000);
    }
  },

  dismissToast: (id: string) => {
    set(state => ({
      toasts: state.toasts.filter(toast => toast.id !== id),
    }));
  },

  setError: (error: CPAPError) => {
    set(state => ({
      toasts: [
        ...state.toasts,
        {
          id: error.id,
          error,
          isVisible: true,
        },
      ],
    }));
  },
}));

// Usage in other stores
import { useUIStore } from './uiStore';

// Inside store action:
try {
  // ... operation
} catch (error) {
  const cpapError = createCPAPError(error);
  useUIStore.getState().addToast(cpapError);
}
```

---

## 4. Worker Error Marshalling

### 4.1 Worker Error Serialization

Web Workers run in separate threads and cannot directly pass Error objects (they are not structurally cloneable). All errors must be serialized.

```typescript
// src/workers/utils/errorMarshalling.ts

/**
 * Serializable error structure for worker-main thread communication
 */
export interface SerializedError {
  id: string;
  category: string;
  severity: string;
  title: string;
  message: string;
  recoverySteps?: string[];
  timestamp: string; // ISO string
  technicalDetails?: {
    stack?: string;
    context?: Record<string, unknown>;
  };
}

/**
 * Serialize a CPAPError for transmission across worker boundary
 */
export function serializeError(error: CPAPError): SerializedError {
  return {
    id: error.id,
    category: error.category,
    severity: error.severity,
    title: error.title,
    message: error.message,
    recoverySteps: error.recoverySteps,
    timestamp: error.timestamp.toISOString(),
    technicalDetails: {
      stack: error.technicalDetails?.stack,
      context: error.technicalDetails?.context,
      // Omit originalError (not serializable)
    },
  };
}

/**
 * Deserialize a worker error back to CPAPError
 */
export function deserializeError(serialized: SerializedError): CPAPError {
  return {
    id: serialized.id,
    category: serialized.category as ErrorCategory,
    severity: serialized.severity as ErrorSeverity,
    title: serialized.title,
    message: serialized.message,
    recoverySteps: serialized.recoverySteps,
    timestamp: new Date(serialized.timestamp),
    technicalDetails: serialized.technicalDetails,
  };
}
```

### 4.2 Worker-Side Error Handling

```typescript
// src/workers/analysisWorker.ts
import { serializeError } from './utils/errorMarshalling';
import { CPAPError, ErrorCategory, ErrorSeverity } from '@/types/errors';

// Worker message handler
self.onmessage = async (event: MessageEvent) => {
  const { operation, data, requestId } = event.data;

  try {
    let result;

    switch (operation) {
      case 'calculate-ahi':
        result = await calculateAHI(data);
        break;

      case 'run-stl-decomposition':
        result = await runSTLDecomposition(data);
        break;

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    // Success response
    self.postMessage({
      requestId,
      success: true,
      result,
    });

  } catch (error) {
    // Convert to CPAPError if not already
    let cpapError: CPAPError;

    if ((error as CPAPError).category) {
      cpapError = error as CPAPError;
    } else {
      cpapError = {
        id: crypto.randomUUID(),
        category: ErrorCategory.WORKER,
        severity: ErrorSeverity.ERROR,
        title: 'Computation Failed',
        message: `The ${operation} operation failed: ${(error as Error).message}`,
        recoverySteps: [
          'Try adjusting the analysis parameters',
          'Reduce the date range',
          'Try again later',
        ],
        technicalDetails: {
          originalError: error as Error,
          stack: (error as Error).stack,
          context: {
            operation,
            dataKeys: Object.keys(data),
          },
        },
        timestamp: new Date(),
      };
    }

    // Serialize and send error response
    self.postMessage({
      requestId,
      success: false,
      error: serializeError(cpapError),
    });
  }
};

// Handle uncaught errors in worker
self.onerror = (event: ErrorEvent) => {
  const error: CPAPError = {
    id: crypto.randomUUID(),
    category: ErrorCategory.WORKER,
    severity: ErrorSeverity.FATAL,
    title: 'Worker Crashed',
    message: 'A background computation process encountered a fatal error.',
    technicalDetails: {
      context: {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    },
    timestamp: new Date(),
  };

  self.postMessage({
    requestId: null,
    success: false,
    error: serializeError(error),
  });

  event.preventDefault();
};
```

### 4.3 Main Thread Worker Manager

```typescript
// src/services/workerManager.ts
import { CPAPError, ErrorCategory, ErrorSeverity } from '@/types/errors';
import { deserializeError, SerializedError } from '@/workers/utils/errorMarshalling';

interface WorkerRequest {
  requestId: string;
  operation: string;
  resolve: (result: unknown) => void;
  reject: (error: CPAPError) => void;
  timeoutId: number;
}

export class WorkerManager {
  private worker: Worker;
  private pendingRequests: Map<string, WorkerRequest> = new Map();
  private isHealthy: boolean = true;
  private defaultTimeout: number = 30000; // 30 seconds

  constructor(workerScript: string) {
    this.worker = new Worker(workerScript, { type: 'module' });
    this.worker.onmessage = this.handleMessage.bind(this);
    this.worker.onerror = this.handleError.bind(this);
  }

  /**
   * Execute operation in worker with timeout
   */
  async execute<T>(
    operation: string,
    data: unknown,
    timeout: number = this.defaultTimeout
  ): Promise<T> {
    if (!this.isHealthy) {
      throw this.createWorkerUnavailableError(operation);
    }

    const requestId = crypto.randomUUID();

    return new Promise<T>((resolve, reject) => {
      // Set timeout
      const timeoutId = window.setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(this.createTimeoutError(operation, timeout));
      }, timeout);

      // Store request
      this.pendingRequests.set(requestId, {
        requestId,
        operation,
        resolve: resolve as (result: unknown) => void,
        reject,
        timeoutId,
      });

      // Send to worker
      try {
        this.worker.postMessage({ requestId, operation, data });
      } catch (error) {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(requestId);
        reject(this.createPostMessageError(operation, error as Error));
      }
    });
  }

  /**
   * Handle successful or error responses from worker
   */
  private handleMessage(event: MessageEvent): void {
    const { requestId, success, result, error } = event.data;

    const request = this.pendingRequests.get(requestId);
    if (!request) {
      console.warn(`Received response for unknown request: ${requestId}`);
      return;
    }

    clearTimeout(request.timeoutId);
    this.pendingRequests.delete(requestId);

    if (success) {
      request.resolve(result);
    } else {
      const cpapError = deserializeError(error as SerializedError);
      request.reject(cpapError);
    }
  }

  /**
   * Handle worker crash
   */
  private handleError(event: ErrorEvent): void {
    console.error('Worker error:', event);

    this.isHealthy = false;

    const error = this.createWorkerCrashError(event);

    // Reject all pending requests
    for (const request of this.pendingRequests.values()) {
      clearTimeout(request.timeoutId);
      request.reject(error);
    }

    this.pendingRequests.clear();

    // Attempt to restart worker after delay
    setTimeout(() => {
      this.restartWorker();
    }, 1000);
  }

  /**
   * Restart worker after crash
   */
  private restartWorker(): void {
    try {
      this.worker.terminate();
      this.worker = new Worker(this.worker.scriptURL, { type: 'module' });
      this.worker.onmessage = this.handleMessage.bind(this);
      this.worker.onerror = this.handleError.bind(this);
      this.isHealthy = true;
      console.log('Worker restarted successfully');
    } catch (error) {
      console.error('Failed to restart worker:', error);
    }
  }

  /**
   * Terminate worker
   */
  terminate(): void {
    this.worker.terminate();
    this.isHealthy = false;

    // Clear all pending requests
    for (const request of this.pendingRequests.values()) {
      clearTimeout(request.timeoutId);
    }
    this.pendingRequests.clear();
  }

  // Error factory methods

  private createTimeoutError(operation: string, timeout: number): CPAPError {
    return {
      id: crypto.randomUUID(),
      category: ErrorCategory.WORKER,
      severity: ErrorSeverity.ERROR,
      title: 'Operation Timeout',
      message: `The ${operation} operation took longer than ${timeout / 1000} seconds and was cancelled.`,
      recoverySteps: [
        'Try reducing the date range or data complexity',
        'Close other browser tabs to free resources',
        'Try the operation again',
      ],
      technicalDetails: {
        context: { operation, timeout },
      },
      timestamp: new Date(),
    };
  }

  private createWorkerCrashError(event: ErrorEvent): CPAPError {
    return {
      id: crypto.randomUUID(),
      category: ErrorCategory.WORKER,
      severity: ErrorSeverity.FATAL,
      title: 'Background Process Crashed',
      message: 'A background computation process crashed unexpectedly. The worker has been restarted.',
      recoverySteps: [
        'Try the operation again',
        'If the issue persists, reload the application',
        'Reduce data complexity or range',
      ],
      technicalDetails: {
        context: {
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      },
      timestamp: new Date(),
    };
  }

  private createWorkerUnavailableError(operation: string): CPAPError {
    return {
      id: crypto.randomUUID(),
      category: ErrorCategory.WORKER,
      severity: ErrorSeverity.ERROR,
      title: 'Worker Unavailable',
      message: `Cannot execute ${operation} because the background worker is not available.`,
      recoverySteps: [
        'Reload the application',
        'Check browser console for errors',
        'Try a different browser',
      ],
      timestamp: new Date(),
    };
  }

  private createPostMessageError(operation: string, error: Error): CPAPError {
    return {
      id: crypto.randomUUID(),
      category: ErrorCategory.WORKER,
      severity: ErrorSeverity.ERROR,
      title: 'Worker Communication Failed',
      message: `Failed to send ${operation} request to background worker.`,
      recoverySteps: [
        'Try the operation again',
        'Reload the application',
      ],
      technicalDetails: {
        originalError: error,
      },
      timestamp: new Date(),
    };
  }
}
```

### 4.4 Retry Logic for Worker Operations

```typescript
// src/services/workerRetry.ts
import { CPAPError, ErrorSeverity } from '@/types/errors';
import { WorkerManager } from './workerManager';

interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

/**
 * Execute worker operation with exponential backoff retry
 */
export async function executeWithRetry<T>(
  workerManager: WorkerManager,
  operation: string,
  data: unknown,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    backoffMultiplier = 2,
  } = options;

  let lastError: CPAPError | null = null;
  let delayMs = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await workerManager.execute<T>(operation, data);
    } catch (error) {
      lastError = error as CPAPError;

      // Don't retry fatal errors or user errors
      if (
        lastError.severity === ErrorSeverity.FATAL ||
        lastError.category === 'USER'
      ) {
        throw lastError;
      }

      // Last attempt, throw error
      if (attempt === maxAttempts) {
        throw lastError;
      }

      // Wait before retry with exponential backoff
      await new Promise(resolve => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * backoffMultiplier, maxDelayMs);

      console.log(`Retrying ${operation} (attempt ${attempt + 1}/${maxAttempts})...`);
    }
  }

  throw lastError;
}
```

---

## 5. User-Facing Error Messages

### 5.1 Error Message Component

```typescript
// src/components/ui/ErrorMessage.tsx
import React from 'react';
import { CPAPError, ErrorSeverity } from '@/types/errors';
import { AlertTriangle, AlertCircle, Info, X } from 'lucide-react';
import { Button } from './Button';
import styles from './ErrorMessage.module.css';

interface ErrorMessageProps {
  error: CPAPError;
  onRetry?: () => void;
  onDismiss?: () => void;
  compact?: boolean;
}

export function ErrorMessage({
  error,
  onRetry,
  onDismiss,
  compact = false,
}: ErrorMessageProps) {
  const Icon = getSeverityIcon(error.severity);
  const severityClass = styles[`severity-${error.severity.toLowerCase()}`];

  if (compact) {
    return (
      <div className={`${styles.errorCompact} ${severityClass}`}>
        <Icon size={20} />
        <span>{error.message}</span>
        {onRetry && <Button onClick={onRetry} size="small">Retry</Button>}
      </div>
    );
  }

  return (
    <div className={`${styles.error} ${severityClass}`} role="alert">
      <div className={styles.errorHeader}>
        <div className={styles.errorIcon}>
          <Icon size={24} />
        </div>
        <div className={styles.errorTitle}>
          <h3>{error.title}</h3>
          <span className={styles.errorTimestamp}>
            {error.timestamp.toLocaleTimeString()}
          </span>
        </div>
        {onDismiss && (
          <button
            className={styles.dismissButton}
            onClick={onDismiss}
            aria-label="Dismiss error"
          >
            <X size={20} />
          </button>
        )}
      </div>

      <div className={styles.errorBody}>
        <p className={styles.errorMessage}>{error.message}</p>

        {error.recoverySteps && error.recoverySteps.length > 0 && (
          <div className={styles.recoverySteps}>
            <h4>What can I do?</h4>
            <ol>
              {error.recoverySteps.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {(onRetry || error.retry) && (
        <div className={styles.errorActions}>
          <Button onClick={onRetry || error.retry} variant="primary">
            Try Again
          </Button>
        </div>
      )}
    </div>
  );
}

function getSeverityIcon(severity: ErrorSeverity) {
  switch (severity) {
    case ErrorSeverity.FATAL:
    case ErrorSeverity.ERROR:
      return AlertTriangle;
    case ErrorSeverity.WARNING:
      return AlertCircle;
    case ErrorSeverity.INFO:
      return Info;
  }
}
```

### 5.2 Toast Notification System

```typescript
// src/components/ui/ToastContainer.tsx
import React from 'react';
import { useUIStore } from '@/stores/uiStore';
import { ErrorMessage } from './ErrorMessage';
import styles from './ToastContainer.module.css';

export function ToastContainer() {
  const toasts = useUIStore(state => state.toasts);
  const dismissToast = useUIStore(state => state.dismissToast);

  return (
    <div className={styles.toastContainer} aria-live="polite" aria-atomic="false">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`${styles.toast} ${toast.isVisible ? styles.visible : styles.hidden}`}
        >
          <ErrorMessage
            error={toast.error}
            onDismiss={() => dismissToast(toast.id)}
          />
        </div>
      ))}
    </div>
  );
}
```

### 5.3 Error Message Templates

**Standardized message templates for common error scenarios**:

```typescript
// src/utils/errorTemplates.ts
import { CPAPError, ErrorCategory, ErrorSeverity } from '@/types/errors';

export const ErrorTemplates = {
  STORAGE_QUOTA_EXCEEDED: (): CPAPError => ({
    id: crypto.randomUUID(),
    category: ErrorCategory.SYSTEM,
    severity: ErrorSeverity.ERROR,
    title: 'Storage Full',
    message: 'Your browser storage is full. Import has been cancelled.',
    recoverySteps: [
      'Go to Data Management and delete old sessions',
      'Clear browser cache and site data',
      'Free up disk space on your device',
    ],
    timestamp: new Date(),
  }),

  FILE_NOT_SUPPORTED: (fileName: string): CPAPError => ({
    id: crypto.randomUUID(),
    category: ErrorCategory.DATA,
    severity: ErrorSeverity.WARNING,
    title: 'File Not Supported',
    message: `The file "${fileName}" is not a supported CPAP data file.`,
    recoverySteps: [
      'Verify the file is from your CPAP machine SD card',
      'Currently supported: ResMed AirSense 10/11 EDF files',
      'Try importing a different file',
    ],
    timestamp: new Date(),
  }),

  NO_SESSIONS_SELECTED: (): CPAPError => ({
    id: crypto.randomUUID(),
    category: ErrorCategory.USER,
    severity: ErrorSeverity.INFO,
    title: 'No Sessions Selected',
    message: 'Please select at least one session to continue.',
    recoverySteps: [
      'Select one or more sessions from the table',
      'Use the date range picker to filter sessions',
      'Use "Select All" to quickly select all visible sessions',
    ],
    timestamp: new Date(),
  }),

  INVALID_DATE_RANGE: (): CPAPError => ({
    id: crypto.randomUUID(),
    category: ErrorCategory.USER,
    severity: ErrorSeverity.WARNING,
    title: 'Invalid Date Range',
    message: 'The end date must be after the start date.',
    recoverySteps: ['Adjust the date range to ensure end date is after start date'],
    timestamp: new Date(),
  }),

  BROWSER_NOT_SUPPORTED: (feature: string): CPAPError => ({
    id: crypto.randomUUID(),
    category: ErrorCategory.SYSTEM,
    severity: ErrorSeverity.FATAL,
    title: 'Browser Not Supported',
    message: `This application requires ${feature}, which is not available in your browser.`,
    recoverySteps: [
      'Update to a modern browser (Chrome 84+, Firefox 87+, Safari 15.2+)',
      'Check for browser updates',
      'Try using a different browser',
    ],
    timestamp: new Date(),
  }),

  COMPUTATION_FAILED: (operation: string, reason?: string): CPAPError => ({
    id: crypto.randomUUID(),
    category: ErrorCategory.WORKER,
    severity: ErrorSeverity.ERROR,
    title: 'Computation Failed',
    message: `The ${operation} operation failed${reason ? `: ${reason}` : ''}.`,
    recoverySteps: [
      'Try adjusting the analysis parameters',
      'Reduce the date range or complexity',
      'Close other browser tabs to free resources',
      'Try again later',
    ],
    timestamp: new Date(),
  }),
};
```

---

## 6. Recovery Workflows

### 6.1 Import Failures: Partial Import and Retry

**Scenario**: User imports multiple files, some succeed, some fail.

**Strategy**: Allow partial import with detailed report of successes and failures.

```typescript
// src/services/importService.ts
interface ImportResult {
  successful: File[];
  failed: Array<{ file: File; error: CPAPError }>;
}

export async function importFiles(files: File[]): Promise<ImportResult> {
  const results: ImportResult = {
    successful: [],
    failed: [],
  };

  for (const file of files) {
    try {
      await importSingleFile(file);
      results.successful.push(file);
    } catch (error) {
      results.failed.push({
        file,
        error: error as CPAPError,
      });
    }
  }

  return results;
}

// UI component shows summary
function ImportSummary({ result }: { result: ImportResult }) {
  if (result.failed.length === 0) {
    return (
      <SuccessMessage>
        Successfully imported {result.successful.length} file(s).
      </SuccessMessage>
    );
  }

  if (result.successful.length === 0) {
    return (
      <ErrorMessage error={ErrorTemplates.COMPUTATION_FAILED('Import', 'All files failed')}>
        <Button onClick={() => retryImport(result.failed.map(f => f.file))}>
          Retry All
        </Button>
      </ErrorMessage>
    );
  }

  return (
    <div>
      <PartialSuccessMessage>
        Imported {result.successful.length} of {files.length} file(s).
      </PartialSuccessMessage>

      <details>
        <summary>Failed Files ({result.failed.length})</summary>
        <ul>
          {result.failed.map(({ file, error }) => (
            <li key={file.name}>
              <strong>{file.name}</strong>: {error.message}
              <Button onClick={() => retryImport([file])}>Retry</Button>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
```

### 6.2 Storage Quota Exceeded: Cleanup UI

**Scenario**: User exceeds browser storage quota during import or analysis.

**Strategy**: Provide storage management UI to free space before retrying.

```typescript
// src/components/settings/StorageManager.tsx
import React, { useEffect, useState } from 'react';
import { useSessionStore } from '@/stores/sessionStore';

interface StorageInfo {
  used: number;
  quota: number;
  usagePercent: number;
}

export function StorageManager() {
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const sessions = useSessionStore(state => state.sessions);
  const deleteSession = useSessionStore(state => state.deleteSession);

  useEffect(() => {
    checkStorage();
  }, []);

  async function checkStorage() {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      setStorageInfo({
        used: estimate.usage || 0,
        quota: estimate.quota || 0,
        usagePercent: ((estimate.usage || 0) / (estimate.quota || 1)) * 100,
      });
    }
  }

  const sessionsBySize = sessions
    .map(session => ({
      ...session,
      // Estimate size based on data
      estimatedSize: estimateSessionSize(session),
    }))
    .sort((a, b) => b.estimatedSize - a.estimatedSize);

  return (
    <div className="storage-manager">
      <h2>Storage Management</h2>

      {storageInfo && (
        <div className="storage-overview">
          <p>
            Using {formatBytes(storageInfo.used)} of {formatBytes(storageInfo.quota)} (
            {storageInfo.usagePercent.toFixed(1)}%)
          </p>
          <progress value={storageInfo.used} max={storageInfo.quota} />

          {storageInfo.usagePercent > 80 && (
            <ErrorMessage
              error={{
                ...ErrorTemplates.STORAGE_QUOTA_EXCEEDED(),
                severity: 'WARNING',
                title: 'Storage Nearly Full',
                message: 'Consider deleting old sessions to free up space.',
              }}
            />
          )}
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Session Date</th>
            <th>Estimated Size</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sessionsBySize.map(session => (
            <tr key={session.id}>
              <td>{session.date.toLocaleDateString()}</td>
              <td>{formatBytes(session.estimatedSize)}</td>
              <td>
                <Button
                  variant="danger"
                  onClick={async () => {
                    await deleteSession(session.id);
                    await checkStorage();
                  }}
                >
                  Delete
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
```

### 6.3 Analysis Failures: Parameter Adjustment

**Scenario**: Analysis fails due to incompatible parameters or insufficient data.

**Strategy**: Guide user to adjust parameters or provide sensible defaults.

```typescript
// src/components/analysis/AnalysisPanel.tsx
function AnalysisPanel() {
  const [error, setError] = useState<CPAPError | null>(null);

  async function runAnalysis(params: AnalysisParams) {
    setError(null);

    try {
      const result = await analysisService.run(params);
      setResult(result);
    } catch (error) {
      const cpapError = error as CPAPError;
      setError(cpapError);

      // Attempt to suggest corrected parameters
      if (cpapError.category === ErrorCategory.USER) {
        const suggestedParams = suggestParameterFixes(params, cpapError);
        if (suggestedParams) {
          setError({
            ...cpapError,
            recoverySteps: [
              ...cpapError.recoverySteps || [],
              'Try these suggested parameters:',
            ],
            retry: () => runAnalysis(suggestedParams),
          });
        }
      }
    }
  }

  return (
    <div>
      {error && (
        <ErrorMessage
          error={error}
          onRetry={error.retry}
        />
      )}
      {/* Rest of UI */}
    </div>
  );
}
```

### 6.4 Browser Compatibility: Feature Detection and Graceful Degradation

**Scenario**: User's browser doesn't support required features.

**Strategy**: Detect features at startup, provide fallbacks or clear error messages.

```typescript
// src/utils/featureDetection.ts
import { CPAPError } from '@/types/errors';
import { ErrorTemplates } from './errorTemplates';

interface FeatureSupport {
  indexedDB: boolean;
  opfs: boolean;
  webWorkers: boolean;
  serviceWorker: boolean;
  requestIdleCallback: boolean;
}

export function detectFeatures(): FeatureSupport {
  return {
    indexedDB: 'indexedDB' in window,
    opfs: 'storage' in navigator && 'estimate' in navigator.storage,
    webWorkers: 'Worker' in window,
    serviceWorker: 'serviceWorker' in navigator,
    requestIdleCallback: 'requestIdleCallback' in window,
  };
}

export function validateBrowserCompatibility(): CPAPError[] {
  const features = detectFeatures();
  const errors: CPAPError[] = [];

  // Critical features
  if (!features.indexedDB) {
    errors.push(ErrorTemplates.BROWSER_NOT_SUPPORTED('IndexedDB'));
  }

  if (!features.webWorkers) {
    errors.push(ErrorTemplates.BROWSER_NOT_SUPPORTED('Web Workers'));
  }

  // Optional features (warnings only)
  if (!features.opfs) {
    errors.push({
      ...ErrorTemplates.BROWSER_NOT_SUPPORTED('Origin Private File System (OPFS)'),
      severity: 'WARNING',
      message: 'OPFS is not supported. Large file imports may be slower.',
    });
  }

  if (!features.requestIdleCallback) {
    errors.push({
      ...ErrorTemplates.BROWSER_NOT_SUPPORTED('requestIdleCallback'),
      severity: 'INFO',
      message: 'requestIdleCallback is not supported. Using fallback scheduling.',
    });
  }

  return errors;
}

// Run at app startup
const compatibilityErrors = validateBrowserCompatibility();
if (compatibilityErrors.some(e => e.severity === 'FATAL')) {
  // Show compatibility error page
  renderCompatibilityErrorPage(compatibilityErrors);
} else {
  // Start app, show warnings in UI if any
  startApp();
  compatibilityErrors.forEach(error => {
    if (error.severity === 'WARNING' || error.severity === 'INFO') {
      useUIStore.getState().addToast(error);
    }
  });
}
```

---

## 7. Error Serialization for Offline Logging

### 7.1 Privacy-Safe Error Logging

All error logging MUST strip PHI (Protected Health Information) and session data.

```typescript
// src/services/errorLogging.ts
import { CPAPError } from '@/types/errors';

/**
 * Sanitized error log entry
 */
interface ErrorLogEntry {
  id: string;
  category: string;
  severity: string;
  title: string;
  message: string;
  timestamp: string;
  technicalDetails?: {
    stack?: string;
    // Context is sanitized (no session data, no file names with dates)
    sanitizedContext?: Record<string, unknown>;
  };
}

/**
 * Sanitize error for logging (strip all PHI)
 */
function sanitizeError(error: CPAPError): ErrorLogEntry {
  return {
    id: error.id,
    category: error.category,
    severity: error.severity,
    title: error.title,
    message: error.message,
    timestamp: error.timestamp.toISOString(),
    technicalDetails: {
      stack: error.technicalDetails?.stack,
      sanitizedContext: sanitizeContext(error.technicalDetails?.context),
    },
  };
}

/**
 * Remove PHI from error context
 */
function sanitizeContext(context?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!context) return undefined;

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    // Strip file names (may contain dates/identifiers)
    if (key === 'fileName' || key === 'fileNames') {
      sanitized[key] = '[redacted]';
      continue;
    }

    // Strip session IDs
    if (key === 'sessionId' || key === 'sessionIds') {
      sanitized[key] = '[redacted]';
      continue;
    }

    // Strip any date-like values
    if (value instanceof Date || (typeof value === 'string' && /\d{4}-\d{2}-\d{2}/.test(value))) {
      sanitized[key] = '[redacted]';
      continue;
    }

    // Keep safe metadata
    if (typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value;
      continue;
    }

    if (typeof value === 'string' && value.length < 100) {
      // Keep short strings if they don't look like PHI
      if (!/\d{2,}/.test(value)) {
        sanitized[key] = value;
        continue;
      }
    }

    // Redact everything else
    sanitized[key] = '[redacted]';
  }

  return sanitized;
}
```

### 7.2 Error Log Storage

```typescript
// src/services/errorLogStorage.ts
import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface ErrorLogDB extends DBSchema {
  errors: {
    key: string;
    value: ErrorLogEntry;
    indexes: {
      'by-timestamp': string;
      'by-category': string;
      'by-severity': string;
    };
  };
}

class ErrorLogStorage {
  private db: IDBPDatabase<ErrorLogDB> | null = null;
  private readonly DB_NAME = 'cpap-analyzer-error-logs';
  private readonly DB_VERSION = 1;
  private readonly MAX_LOG_ENTRIES = 1000;

  async init(): Promise<void> {
    this.db = await openDB<ErrorLogDB>(this.DB_NAME, this.DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore('errors', { keyPath: 'id' });
        store.createIndex('by-timestamp', 'timestamp');
        store.createIndex('by-category', 'category');
        store.createIndex('by-severity', 'severity');
      },
    });
  }

  async logError(error: CPAPError): Promise<void> {
    if (!this.db) await this.init();

    const sanitized = sanitizeError(error);
    await this.db!.add('errors', sanitized);

    // Enforce max log size
    await this.enforceMaxSize();
  }

  async getRecentErrors(limit: number = 100): Promise<ErrorLogEntry[]> {
    if (!this.db) await this.init();

    const index = this.db!.transaction('errors').store.index('by-timestamp');
    const entries = await index.getAll();
    return entries.slice(-limit).reverse(); // Most recent first
  }

  async exportLogs(): Promise<string> {
    const errors = await this.getRecentErrors(this.MAX_LOG_ENTRIES);
    return JSON.stringify(errors, null, 2);
  }

  async clearLogs(): Promise<void> {
    if (!this.db) await this.init();
    await this.db!.clear('errors');
  }

  private async enforceMaxSize(): Promise<void> {
    if (!this.db) return;

    const count = await this.db.count('errors');
    if (count > this.MAX_LOG_ENTRIES) {
      const toDelete = count - this.MAX_LOG_ENTRIES;
      const index = this.db.transaction('errors', 'readwrite').store.index('by-timestamp');
      const cursor = await index.openCursor();

      let deleted = 0;
      while (cursor && deleted < toDelete) {
        await cursor.delete();
        deleted++;
        await cursor.continue();
      }
    }
  }
}

export const errorLogStorage = new ErrorLogStorage();
```

### 7.3 Error Log Export UI

```typescript
// src/components/settings/ErrorLogViewer.tsx
import React, { useEffect, useState } from 'react';
import { errorLogStorage } from '@/services/errorLogStorage';
import { ErrorLogEntry } from '@/services/errorLogging';
import { Button } from '@/components/ui/Button';

export function ErrorLogViewer() {
  const [logs, setLogs] = useState<ErrorLogEntry[]>([]);

  useEffect(() => {
    loadLogs();
  }, []);

  async function loadLogs() {
    const recentLogs = await errorLogStorage.getRecentErrors(100);
    setLogs(recentLogs);
  }

  async function handleExport() {
    const json = await errorLogStorage.exportLogs();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cpap-analyzer-error-logs-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleClear() {
    if (confirm('Are you sure you want to clear all error logs?')) {
      await errorLogStorage.clearLogs();
      setLogs([]);
    }
  }

  return (
    <div className="error-log-viewer">
      <div className="header">
        <h2>Error Logs</h2>
        <div className="actions">
          <Button onClick={handleExport}>Export Logs</Button>
          <Button onClick={handleClear} variant="danger">Clear Logs</Button>
        </div>
      </div>

      <p className="privacy-notice">
        Error logs are stored locally and never transmitted. All personally identifiable
        information is automatically removed before logging.
      </p>

      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Severity</th>
            <th>Category</th>
            <th>Title</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {logs.map(log => (
            <tr key={log.id} className={`severity-${log.severity.toLowerCase()}`}>
              <td>{new Date(log.timestamp).toLocaleString()}</td>
              <td>{log.severity}</td>
              <td>{log.category}</td>
              <td>{log.title}</td>
              <td>{log.message}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {logs.length === 0 && (
        <p className="empty-state">No error logs recorded.</p>
      )}
    </div>
  );
}
```

---

## 8. Integration Points

### 8.1 Integration with Frontend Architecture

This error handling architecture connects to [frontend-architecture.md](./frontend-architecture.md) at the following points:

1. **Component Error Boundaries**: Section 2.3 of this document implements the error boundary strategy referenced in frontend-architecture.md section 3.4 (Error Handling).

2. **Zustand Store Patterns**: Section 3 standardizes the error state patterns mentioned in frontend-architecture.md section 4.2 (State Management with Zustand).

3. **Worker Communication**: Section 4 defines the error marshalling for Web Workers described in frontend-architecture.md section 6 (Web Workers with Comlink).

### 8.2 Integration with DevOps Architecture

This error handling architecture supports [devops-architecture.md](./devops-architecture.md) debugging workflows:

1. **Error Log Export**: Section 7.3 provides the exportable error logs referenced in devops-architecture.md section 7 (Debugging and Observability).

2. **Privacy-Safe Logging**: Section 7.1 ensures all logs are PHI-free, meeting the requirements of devops-architecture.md section 9 (Security and Privacy).

3. **CI Integration**: Error boundaries and error state can be tested in devops-architecture.md section 3 (Testing Pipeline).

### 8.3 Integration with UX Design

This error handling architecture implements the error presentation patterns from [ux-design.md](./ux-design.md):

1. **Error Message Components**: Section 5.1 implements the error message design specified in ux-design.md section 8.2 (Error States).

2. **Recovery Workflows**: Section 6 provides the actionable recovery steps mandated by ux-design.md section 2.3 (User Agency).

3. **Toast Notifications**: Section 5.2 implements the non-blocking notification system described in ux-design.md section 5 (Feedback and Notifications).

### 8.4 Integration with Security Architecture

This error handling architecture aligns with security requirements from [security-architecture.md](./security-architecture.md):

1. **PHI Stripping**: Section 7.1 sanitizes all error logs to prevent PHI leakage, as required by security-architecture.md section 4 (Data Privacy).

2. **No External Logging**: All error logging is local-only, meeting the security-architecture.md section 2.1 (No External Dependencies) requirement.

3. **User Control**: Section 7.3 gives users full control over error logs (export, clear), aligning with security-architecture.md section 4.3 (User Data Control).

---

## 9. Testing Strategy

### 9.1 Unit Tests for Error Utilities

```typescript
// src/services/__tests__/errorLogging.test.ts
import { describe, it, expect } from 'vitest';
import { sanitizeError } from '../errorLogging';
import { CPAPError, ErrorCategory, ErrorSeverity } from '@/types/errors';

describe('sanitizeError', () => {
  it('should redact file names', () => {
    const error: CPAPError = {
      id: '123',
      category: ErrorCategory.DATA,
      severity: ErrorSeverity.ERROR,
      title: 'Test',
      message: 'Test',
      timestamp: new Date(),
      technicalDetails: {
        context: {
          fileName: '2024-01-15-session.edf',
        },
      },
    };

    const sanitized = sanitizeError(error);
    expect(sanitized.technicalDetails?.sanitizedContext?.fileName).toBe('[redacted]');
  });

  it('should redact session IDs', () => {
    const error: CPAPError = {
      id: '123',
      category: ErrorCategory.DATA,
      severity: ErrorSeverity.ERROR,
      title: 'Test',
      message: 'Test',
      timestamp: new Date(),
      technicalDetails: {
        context: {
          sessionId: 'abc-123-def',
        },
      },
    };

    const sanitized = sanitizeError(error);
    expect(sanitized.technicalDetails?.sanitizedContext?.sessionId).toBe('[redacted]');
  });

  it('should preserve safe metadata', () => {
    const error: CPAPError = {
      id: '123',
      category: ErrorCategory.WORKER,
      severity: ErrorSeverity.ERROR,
      title: 'Test',
      message: 'Test',
      timestamp: new Date(),
      technicalDetails: {
        context: {
          timeout: 30000,
          operation: 'calculate-ahi',
        },
      },
    };

    const sanitized = sanitizeError(error);
    expect(sanitized.technicalDetails?.sanitizedContext?.timeout).toBe(30000);
    expect(sanitized.technicalDetails?.sanitizedContext?.operation).toBe('calculate-ahi');
  });
});
```

### 9.2 Integration Tests for Error Boundaries

```typescript
// src/components/error-boundaries/__tests__/ComponentErrorBoundary.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComponentErrorBoundary } from '../ComponentErrorBoundary';

function ThrowError({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error');
  }
  return <div>Content</div>;
}

describe('ComponentErrorBoundary', () => {
  it('should render children when no error', () => {
    render(
      <ComponentErrorBoundary componentName="Test">
        <ThrowError shouldThrow={false} />
      </ComponentErrorBoundary>
    );

    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('should render error message when error thrown', () => {
    // Suppress console.error for this test
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ComponentErrorBoundary componentName="Test">
        <ThrowError shouldThrow={true} />
      </ComponentErrorBoundary>
    );

    expect(screen.getByText(/Component Error/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot be displayed/i)).toBeInTheDocument();

    spy.mockRestore();
  });

  it('should retry rendering on retry button click', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();

    const { rerender } = render(
      <ComponentErrorBoundary componentName="Test">
        <ThrowError shouldThrow={true} />
      </ComponentErrorBoundary>
    );

    expect(screen.getByText(/Component Error/i)).toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: /retry/i });
    await user.click(retryButton);

    // After retry, re-render with no error
    rerender(
      <ComponentErrorBoundary componentName="Test">
        <ThrowError shouldThrow={false} />
      </ComponentErrorBoundary>
    );

    expect(screen.getByText('Content')).toBeInTheDocument();
    spy.mockRestore();
  });
});
```

### 9.3 E2E Tests for Error Recovery

```typescript
// e2e/error-recovery.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Error Recovery', () => {
  test('should recover from import failure', async ({ page }) => {
    await page.goto('/');

    // Trigger import with invalid file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'invalid.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not an EDF file'),
    });

    // Should show error message
    await expect(page.locator('[role="alert"]')).toContainText('Import Failed');
    await expect(page.locator('[role="alert"]')).toContainText('not a valid EDF file');

    // Should offer retry
    const retryButton = page.getByRole('button', { name: /try again/i });
    await expect(retryButton).toBeVisible();

    // Should allow navigation away
    await page.goto('/dashboard');
    await expect(page).toHaveURL('/dashboard');
  });

  test('should handle worker timeout gracefully', async ({ page }) => {
    await page.goto('/analysis');

    // Select sessions
    await page.getByRole('checkbox').first().check();

    // Start long-running analysis
    await page.getByRole('button', { name: /run analysis/i }).click();

    // Mock worker timeout by waiting longer than timeout
    await page.waitForTimeout(35000); // Assuming 30s timeout

    // Should show timeout error
    await expect(page.locator('[role="alert"]')).toContainText('Operation Timeout');

    // Should still be functional
    await page.goto('/dashboard');
    await expect(page).toHaveURL('/dashboard');
  });
});
```

---

## 10. Summary

This error handling and recovery architecture provides:

1. **Comprehensive Error Taxonomy**: Five-category classification (User, System, Data, Network, Worker) with clear severity levels.

2. **Robust Error Boundaries**: Three-tier React error boundary strategy (root, route, component) prevents catastrophic failures.

3. **Consistent State Management**: Standardized Zustand error state patterns across all stores with optimistic update rollback.

4. **Worker Resilience**: Structured error serialization, timeout handling, and automatic worker restart on fatal errors.

5. **Clear User Communication**: Severity-based error messages with actionable recovery steps, never leaving users stranded.

6. **Privacy-First Logging**: All error logs are PHI-stripped, stored locally, and fully user-controlled.

7. **Graceful Degradation**: Feature detection and fallback strategies for browser compatibility.

This architecture resolves **QA GAP-1 (BLOCKER)** by providing a unified, well-documented error handling strategy that spans all application layers and aligns with the project's core principles of privacy, performance, and user agency.

---

## Appendix A: Error Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Error Source                                                │
│ (Component, Store, Worker, Storage, Network)                │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Error Classification                                        │
│ Determine: Category, Severity, Recovery Options             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Error Boundary / Store Error Handler                        │
│ Catch and wrap in CPAPError structure                       │
└────────────────────────┬────────────────────────────────────┘
                         │
                    ┌────┴────┐
                    │         │
                    ▼         ▼
         ┌──────────────┐ ┌──────────────┐
         │ Fatal Error  │ │ Recoverable  │
         └──────┬───────┘ └──────┬───────┘
                │                │
                ▼                ▼
     ┌─────────────────┐  ┌─────────────────┐
     │ Error Fallback  │  │ Toast           │
     │ (Full UI)       │  │ Notification    │
     └─────────────────┘  └─────────────────┘
                │                │
                ▼                ▼
     ┌─────────────────┐  ┌─────────────────┐
     │ Recovery Actions│  │ User Dismisses  │
     │ (Reload, Clear) │  │ or Auto-dismiss │
     └─────────────────┘  └─────────────────┘
                │                │
                └────────┬───────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │ Privacy-Safe Error Logging    │
         │ (Sanitize → IndexedDB)        │
         └───────────────────────────────┘
```

---

**Document Status**: ✅ Complete — Addresses QA GAP-1 (BLOCKER)

**Related Documents**:
- [Frontend Architecture](./frontend-architecture.md)
- [UX Design](./ux-design.md)
- [DevOps Architecture](./devops-architecture.md)
- [Security Architecture](./security-architecture.md)
