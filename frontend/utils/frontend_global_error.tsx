import React, { Component, ErrorInfo, ReactNode, useState, useCallback } from 'react';

// ── Constants ─────────────────────────────────────────────────────────────────

export const ERROR_SEVERITY_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export const RECOVERY_ACTIONS = ['retry', 'reload', 'navigate', 'dismiss'] as const;

export type ErrorSeverityLevel = typeof ERROR_SEVERITY_LEVELS[number];
export type RecoveryAction = typeof RECOVERY_ACTIONS[number];

// ── Config ────────────────────────────────────────────────────────────────────

export interface ErrorBoundaryConfig {
  enableLogging: boolean;
  showErrorDetails: boolean;
  enableRecovery: boolean;
  fallback?: ReactNode;
  maxRetries: number;
  reportingEndpoint?: string;
}

export const DEFAULT_ERROR_BOUNDARY_CONFIG: ErrorBoundaryConfig = {
  enableLogging: true,
  showErrorDetails: false,
  enableRecovery: true,
  maxRetries: 3,
};

// ── Error info ────────────────────────────────────────────────────────────────

export interface ErrorInfoType {
  message: string;
  stack?: string;
  componentStack?: string;
  timestamp: Date;
  severity: ErrorSeverityLevel;
  isHandled: boolean;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function determineErrorSeverity(error: Error): ErrorSeverityLevel {
  const msg = `${error.name} ${error.message}`.toLowerCase();
  if (/network|fetch|blockchain|wallet/.test(msg)) return 'critical';
  if (/permission|unauthorized|authentication/.test(msg)) return 'high';
  if (/validation|typeerror|type error|render/.test(msg)) return 'medium';
  return 'low';
}

export function validateErrorBoundaryConfig(config: Partial<ErrorBoundaryConfig>): boolean {
  if (config.maxRetries !== undefined) {
    if (config.maxRetries < 0 || config.maxRetries > 10) return false;
  }
  if (config.reportingEndpoint !== undefined) {
    try {
      new URL(config.reportingEndpoint);
    } catch {
      return false;
    }
  }
  return true;
}

export function createErrorInfo(error: Error, errorInfo: ErrorInfo): ErrorInfoType {
  return {
    message: error.message,
    stack: error.stack,
    componentStack: errorInfo.componentStack ?? undefined,
    timestamp: new Date(),
    severity: determineErrorSeverity(error),
    isHandled: false,
  };
}

// ── Component types ───────────────────────────────────────────────────────────

interface ErrorBoundaryProps {
  children: ReactNode;
  config?: Partial<ErrorBoundaryConfig>;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfoType) => void;
  onRecover?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfoType | null;
  retryCount: number;
  isRecovering: boolean;
}

// ── GlobalErrorBoundary ───────────────────────────────────────────────────────

export class GlobalErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  // Use static property to track retry count across component instances
  private static retryCountMap = new WeakMap<object, number>();

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0,
      isRecovering: false,
    };
    this.handleRetry = this.handleRetry.bind(this);
    this.handleDismiss = this.handleDismiss.bind(this);
    this.handleReload = this.handleReload.bind(this);
  }

  private getRetryCount(): number {
    return GlobalErrorBoundary.retryCountMap.get(this) || 0;
  }

  private setRetryCount(count: number): void {
    GlobalErrorBoundary.retryCountMap.set(this, count);
  }

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    const err =
      error instanceof Error
        ? error
        : new Error(
            error != null && error !== undefined
              ? String(error)
              : 'An unexpected error occurred',
          );
    return {
      hasError: true,
      error: err,
      isRecovering: false,
      // Note: retryCount will be set in componentDidCatch using WeakMap
    };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    const err =
      error instanceof Error
        ? error
        : new Error(
            error != null && error !== undefined
              ? String(error)
              : 'An unexpected error occurred',
          );
    const errorInfoType = createErrorInfo(err, errorInfo);

    // Use the WeakMap retry count
    this.setState({
      errorInfo: errorInfoType,
      retryCount: this.getRetryCount(),
    });

    const cfg = { ...DEFAULT_ERROR_BOUNDARY_CONFIG, ...this.props.config };
    if (cfg.enableLogging) {
      console.error('[GlobalErrorBoundary]', err, errorInfo);
    }

    if (this.props.onError) {
      this.props.onError(err, errorInfoType);
    }
  }

  componentWillUnmount(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  handleRetry(): void {
    const cfg = { ...DEFAULT_ERROR_BOUNDARY_CONFIG, ...this.props.config };
    const currentRetryCount = this.getRetryCount();
    if (currentRetryCount >= cfg.maxRetries) return;

    // Increment the WeakMap retry count
    const newRetryCount = currentRetryCount + 1;
    this.setRetryCount(newRetryCount);

    // Set recovering immediately — renders "Retrying..." without the error UI
    this.setState({ isRecovering: true, retryCount: newRetryCount }, () => {
      this.retryTimer = setTimeout(() => {
        // Reset error state but keep the retry count in WeakMap
        this.setState({
          hasError: false,
          error: null,
          errorInfo: null,
          isRecovering: false,
        });
        this.props.onRecover?.();
      }, 0);
    });
  }

  handleDismiss(): void {
    this.setRetryCount(0);
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0,
      isRecovering: false,
    });
    this.props.onRecover?.();
  }

  handleReload(): void {
    window.location.reload();
  }

  render(): ReactNode {
    const { hasError, error, retryCount, isRecovering } = this.state;
    const { children, fallback, config } = this.props;
    const cfg = { ...DEFAULT_ERROR_BOUNDARY_CONFIG, ...config };

    if (!hasError && !isRecovering) return children;

    if (fallback && !isRecovering) return fallback;

    const errorMessage =
      error?.message?.trim() ? error.message : 'An unexpected error occurred';
    const canRetry = this.getRetryCount() < cfg.maxRetries;

    return (
      <div
        role="alert"
        aria-live="assertive"
        style={{ padding: '24px', maxWidth: '600px', margin: '40px auto' }}
      >
        {isRecovering ? (
          <div>
            <h2>Retrying...</h2>
            <p>Attempting to recover from the error.</p>
          </div>
        ) : (
          <>
            <h2>Something went wrong</h2>
            <p>{errorMessage}</p>
          </>
        )}
        {cfg.enableRecovery && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            {canRetry && !isRecovering && (
              <button onClick={this.handleRetry} disabled={isRecovering}>
                Retry
              </button>
            )}
            {retryCount > 0 && !isRecovering && (
              <p>Retry attempt: {retryCount}</p>
            )}
            {!isRecovering && (
              <button onClick={this.handleReload}>Reload Page</button>
            )}
            {!isRecovering && (
              <button
                onClick={this.handleDismiss}
                aria-label="Dismiss error and try to continue"
              >
                Dismiss
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
}

// ── withErrorBoundary HOC ─────────────────────────────────────────────────────

export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  config?: Partial<ErrorBoundaryConfig>,
): React.ComponentType<P> {
  const displayName = WrappedComponent.displayName || WrappedComponent.name || 'Component';
  const WithBoundary = (props: P) => (
    <GlobalErrorBoundary config={config}>
      <WrappedComponent {...props} />
    </GlobalErrorBoundary>
  );
  WithBoundary.displayName = `withErrorBoundary(${displayName})`;
  return WithBoundary;
}

// ── useErrorBoundary hook ─────────────────────────────────────────────────────

export function useErrorBoundary() {
  const [error, setError] = useState<Error | null>(null);
  const hasError = error !== null;

  const triggerError = useCallback((err: Error) => {
    setError(err);
  }, []);

  const resetError = useCallback(() => {
    setError(null);
  }, []);

  return { error, hasError, triggerError, resetError };
}

export default GlobalErrorBoundary;
