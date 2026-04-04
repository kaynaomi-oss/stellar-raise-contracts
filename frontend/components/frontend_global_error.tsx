import React, { Component, ErrorInfo, ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Custom Error Classes
// ---------------------------------------------------------------------------

/**
 * @title ContractError
 * @dev Represents errors originating from smart contract execution on Stellar/Soroban.
 */
export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractError';
  }
}

/**
 * @title NetworkError
 * @dev Represents errors caused by network connectivity issues.
 */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * @title TransactionError
 * @dev Represents errors during blockchain transaction submission, signing, or confirmation.
 */
export class TransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransactionError';
  }
}

// ---------------------------------------------------------------------------
// Error classification helpers
// ---------------------------------------------------------------------------

const CONTRACT_KEYWORDS = [
  'contract',
  'stellar',
  'soroban',
  'transaction',
  'blockchain',
  'ledger',
  'horizon',
  'xdr',
  'invoke',
  'wallet',
] as const;

const _classificationCache = new WeakMap<Error, boolean>();

function isSmartContractError(error: Error): boolean {
  if (_classificationCache.has(error)) {
    return _classificationCache.get(error)!;
  }
  let result: boolean;
  if (
    error instanceof ContractError ||
    error instanceof NetworkError ||
    error instanceof TransactionError
  ) {
    result = true;
  } else {
    const haystack = `${error.name} ${error.message}`.toLowerCase();
    result = CONTRACT_KEYWORDS.some((kw) => haystack.includes(kw));
  }
  _classificationCache.set(error, result);
  return result;
}

// ---------------------------------------------------------------------------
// Structured error report
// ---------------------------------------------------------------------------

export interface ErrorReport {
  message: string;
  stack: string | undefined;
  componentStack: string | null | undefined;
  timestamp: string;
  isSmartContractError: boolean;
  errorName: string;
}

function buildErrorReport(
  error: Error,
  errorInfo: ErrorInfo,
  isContract: boolean,
): ErrorReport {
  const isDev = process.env.NODE_ENV !== 'production';
  return {
    message: error.message,
    stack: isDev ? error.stack : undefined,
    componentStack: isDev ? errorInfo.componentStack : undefined,
    timestamp: new Date().toISOString(),
    isSmartContractError: isContract,
    errorName: error.name,
  };
}

// ---------------------------------------------------------------------------
// Component types
// ---------------------------------------------------------------------------

export const MAX_RETRIES = 3;

export interface FrontendGlobalErrorBoundaryProps {
  children?: ReactNode;
  fallback?: ReactNode;
  onError?: (report: ErrorReport) => void;
}

interface BoundaryState {
  hasError: boolean;
  error: Error | null;
  isSmartContractError: boolean;
  retryCount: number;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '24px',
    maxWidth: '600px',
    margin: '40px auto',
    borderRadius: '8px',
    backgroundColor: '#fff',
    boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
    fontFamily: 'sans-serif',
  } as React.CSSProperties,
  icon: {
    fontSize: '2rem',
  } as React.CSSProperties,
  title: {
    margin: '0 0 8px',
  } as React.CSSProperties,
  message: {
    margin: '0 0 8px',
  } as React.CSSProperties,
  hint: {
    margin: '0 0 12px',
  } as React.CSSProperties,
  details: {
    marginTop: '12px',
  } as React.CSSProperties,
  pre: {
    whiteSpace: 'pre-wrap' as const,
    fontSize: '0.8rem',
    background: '#f5f5f5',
    padding: '8px',
    borderRadius: '4px',
  } as React.CSSProperties,
  actions: {
    display: 'flex',
    gap: '8px',
    marginTop: '16px',
  } as React.CSSProperties,
  primaryButton: {
    padding: '8px 18px',
    backgroundColor: '#4f46e5',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 600,
  } as React.CSSProperties,
  secondaryButton: {
    padding: '8px 18px',
    backgroundColor: '#e5e7eb',
    color: '#111',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 600,
  } as React.CSSProperties,
};

// ---------------------------------------------------------------------------
// FrontendGlobalErrorBoundary
// ---------------------------------------------------------------------------

export class FrontendGlobalErrorBoundary extends Component<
  FrontendGlobalErrorBoundaryProps,
  BoundaryState
> {
  constructor(props: FrontendGlobalErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      isSmartContractError: false,
      retryCount: 0,
    };
    this.handleRetry = this.handleRetry.bind(this);
  }

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    const err =
      error instanceof Error
        ? error
        : new Error(error != null ? String(error) : 'An unexpected error occurred');
    return {
      hasError: true,
      error: err,
      isSmartContractError: isSmartContractError(err),
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const normalisedError = this.state.error ?? error;
    const isContract = isSmartContractError(normalisedError);
    const report = buildErrorReport(normalisedError, errorInfo, isContract);

    console.error(
      'Documentation Error Boundary caught an error:',
      error,
      errorInfo,
    );

    if (typeof this.props.onError === 'function') {
      this.props.onError(report);
    }
  }

  handleRetry(): void {
    if (this.state.retryCount >= MAX_RETRIES) return;
    this.setState((prev) => ({
      hasError: false,
      error: null,
      isSmartContractError: false,
      retryCount: prev.retryCount + 1,
    }));
  }

  render(): ReactNode {
    const { hasError, error, isSmartContractError: isContract, retryCount } = this.state;
    const { fallback, children } = this.props;
    const isDev = process.env.NODE_ENV !== 'production';
    const canRetry = retryCount < MAX_RETRIES;

    if (!hasError) {
      return children ?? null;
    }

    if (fallback) {
      return fallback;
    }

    if (isContract) {
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="error-boundary error-boundary--contract"
          style={styles.container}
        >
          <span aria-hidden="true" style={styles.icon}>🔗</span>
          <h2 style={styles.title}>Smart Contract Error</h2>
          <p style={styles.message}>
            A blockchain interaction failed. This may be due to insufficient
            funds, a rejected transaction, or a temporary network issue.
          </p>
          <p style={styles.hint}>
            Check your wallet balance, ensure your wallet is connected, then try
            again.
          </p>
          {isDev && error && (
            <details style={styles.details}>
              <summary>Error Details (dev only)</summary>
              <pre style={styles.pre}>{error.message}</pre>
            </details>
          )}
          <div style={styles.actions}>
            {canRetry && (
              <button
                onClick={this.handleRetry}
                style={styles.primaryButton}
                aria-label="Try Again"
              >
                Try Again
              </button>
            )}
            <button
              onClick={() => { window.location.href = '/'; }}
              style={styles.secondaryButton}
              aria-label="Go Home"
            >
              Go Home
            </button>
          </div>
          {!canRetry && (
            <p style={styles.hint} role="status">
              Maximum retry attempts reached. Please reload the page.
            </p>
          )}
        </div>
      );
    }

    return (
      <div
        role="alert"
        aria-live="assertive"
        className="error-boundary error-boundary--generic"
        style={styles.container}
      >
        <span aria-hidden="true" style={styles.icon}>⚠️</span>
        <h2 style={styles.title}>Documentation Loading Error</h2>
        <p style={styles.message}>
          We&apos;re sorry, but the documentation content failed to load due to
          an unexpected error.
        </p>
        {isDev && error && (
          <details style={styles.details}>
            <summary>Error Details (dev only)</summary>
            <pre style={styles.pre}>{error.message}</pre>
          </details>
        )}
        <div style={styles.actions}>
          {canRetry && (
            <button
              onClick={this.handleRetry}
              style={styles.primaryButton}
              aria-label="Try Again"
            >
              Try Again
            </button>
          )}
          <button
            onClick={() => { window.location.href = '/'; }}
            style={styles.secondaryButton}
            aria-label="Go Home"
          >
            Go Home
          </button>
        </div>
        {!canRetry && (
          <p style={styles.hint} role="status">
            Maximum retry attempts reached. Please reload the page.
          </p>
        )}
      </div>
    );
  }
}

export default FrontendGlobalErrorBoundary;
