import React, { Component, ErrorInfo, ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Custom Error Classes
// ---------------------------------------------------------------------------

/**
 * @title ContractError
 * @dev Represents errors originating from smart contract execution on Stellar/Soroban.
 * Thrown when a contract invocation fails, returns an unexpected result, or
 * the transaction is rejected by the network.
 *
 * @custom:security Never include raw contract state or private keys in the message.
 */
export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractError';
  }
}

/**
 * @title NetworkError
 * @dev Represents errors caused by network connectivity issues when communicating
 * with the Stellar Horizon API or RPC endpoints.
 */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * @title TransactionError
 * @dev Represents errors that occur during blockchain transaction submission,
 * signing, or confirmation phases.
 *
 * @custom:security Do not embed transaction XDR or signing keys in the message.
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

/** Keywords that indicate a smart-contract / blockchain related error. */
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
];

/**
 * @dev Determines whether an error is related to smart contract execution.
 * Checks the error type, name, and message against known patterns.
 *
 * @param error The error to classify.
 * @return `true` if the error is contract/blockchain related.
 *
 * @custom:security This is a best-effort heuristic. Unknown error types default
 * to the generic handler, which is the safer path.
 */
function isSmartContractError(error: Error): boolean {
  if (
    error instanceof ContractError ||
    error instanceof NetworkError ||
    error instanceof TransactionError
  ) {
    return true;
  }
  const haystack = `${error.name} ${error.message}`.toLowerCase();
  return CONTRACT_KEYWORDS.some((kw) => haystack.includes(kw));
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

/**
 * @dev Builds a structured, sanitised error report suitable for forwarding to
 * an external observability service (Sentry, Datadog, etc.).
 *
 * @custom:security Stack traces are included only in development mode so that
 * sensitive implementation details are not exposed in production logs.
 */
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

export interface FrontendGlobalErrorBoundaryProps {
  /**
   * @dev The child component tree to protect with this error boundary.
   */
  children?: ReactNode;

  /**
   * @dev Optional custom fallback UI. When provided it replaces the built-in
   * fallback entirely, giving callers full control over the error presentation.
   */
  fallback?: ReactNode;

  /**
   * @dev Optional callback invoked with a structured error report whenever an
   * error is caught. Use this to forward errors to Sentry, LogRocket, etc.
   *
   * @param report Sanitised error report (stack omitted in production).
   */
  onError?: (report: ErrorReport) => void;
}

interface BoundaryState {
  hasError: boolean;
  error: Error | null;
  isSmartContractError: boolean;
}

// ---------------------------------------------------------------------------
// FrontendGlobalErrorBoundary
// ---------------------------------------------------------------------------

/**
 * @title FrontendGlobalErrorBoundary
 * @dev React class-based error boundary for the Stellar Raise frontend.
 *
 * Catches synchronous render-phase errors anywhere in the wrapped component
 * tree, classifies them (generic vs. smart-contract), logs a structured report,
 * and renders an appropriate fallback UI with a "Try Again" recovery path.
 *
 * Lifecycle:
 *   Error thrown → getDerivedStateFromError (state update) →
 *   componentDidCatch (logging + reporting) → fallback render
 *
 * @custom:security
 *   - Stack traces are suppressed in production to prevent information disclosure.
 *   - The fallback UI uses only static strings; no raw error data is injected
 *     into innerHTML, preventing XSS from crafted error messages.
 *   - The `onError` callback receives a sanitised report; callers must not log
 *     raw `error.stack` in production.
 *
 * @custom:limitations
 *   - Does NOT catch errors in async event handlers, setTimeout, or SSR.
 *   - Does NOT catch errors thrown inside the boundary's own render method.
 *   - Nested boundaries can be used for more granular isolation.
 */
export class FrontendGlobalErrorBoundary extends Component<
  FrontendGlobalErrorBoundaryProps,
  BoundaryState
> {
  constructor(props: FrontendGlobalErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, isSmartContractError: false };
    this.handleRetry = this.handleRetry.bind(this);
  }

  // -------------------------------------------------------------------------
  // Static lifecycle
  // -------------------------------------------------------------------------

  /**
   * @dev Updates component state so the next render shows the fallback UI.
   * Called synchronously during the render phase — must be a pure function.
   *
   * @param error The error that was thrown.
   * @return Partial state update.
   */
  static getDerivedStateFromError(error: Error): BoundaryState {
    return {
      hasError: true,
      error,
      isSmartContractError: isSmartContractError(error),
    };
  }

  // -------------------------------------------------------------------------
  // Instance lifecycle
  // -------------------------------------------------------------------------

  /**
   * @dev Called after an error has been thrown by a descendant component.
   * Responsible for side-effects: logging and external error reporting.
   *
   * @param error The error that was thrown.
   * @param errorInfo React-provided component stack information.
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const isContract = isSmartContractError(error);
    const report = buildErrorReport(error, errorInfo, isContract);

    // Structured console log — always emitted so developers can see errors
    // in both dev and production environments (server logs / browser console).
    console.error(
      'Documentation Error Boundary caught an error:',
      error,
      errorInfo,
    );

    // Forward to caller-supplied reporting hook (Sentry, Datadog, etc.)
    if (typeof this.props.onError === 'function') {
      this.props.onError(report);
    }
  }

  // -------------------------------------------------------------------------
  // Recovery
  // -------------------------------------------------------------------------

  /**
   * @dev Resets error state so the child tree is re-rendered.
   * The child component is responsible for resolving the underlying issue
   * before this is called (e.g. data has reloaded, wallet reconnected).
   */
  handleRetry(): void {
    this.setState({ hasError: false, error: null, isSmartContractError: false });
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  render(): ReactNode {
    const { hasError, error, isSmartContractError: isContract } = this.state;
    const { fallback, children } = this.props;
    const isDev = process.env.NODE_ENV !== 'production';

    if (!hasError) {
      return children ?? null;
    }

    // Caller-supplied custom fallback takes full precedence.
    if (fallback) {
      return fallback;
    }

    // Built-in fallback — smart-contract variant.
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
            <button
              onClick={this.handleRetry}
              style={styles.primaryButton}
              aria-label="Try Again"
            >
              Try Again
            </button>
            <button
              onClick={() => { window.location.href = '/'; }}
              style={styles.secondaryButton}
              aria-label="Go Home"
            >
              Go Home
            </button>
          </div>
        </div>
      );
    }

    // Built-in fallback — generic variant.
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
          <button
            onClick={this.handleRetry}
            style={styles.primaryButton}
            aria-label="Try Again"
          >
            Try Again
          </button>
          <button
            onClick={() => { window.location.href = '/'; }}
            style={styles.secondaryButton}
            aria-label="Go Home"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }
}

// ---------------------------------------------------------------------------
// Inline styles (no CSS dependency — boundary must render even if CSS fails)
// ---------------------------------------------------------------------------

const styles = {
  container: {
    padding: '24px',
    border: '1px solid #ff4d4f',
    borderRadius: '6px',
    backgroundColor: '#fff2f0',
    color: '#cf1322',
    maxWidth: '600px',
    margin: '40px auto',
    fontFamily: 'sans-serif',
  } as React.CSSProperties,
  icon: {
    fontSize: '2rem',
    display: 'block',
    marginBottom: '8px',
  } as React.CSSProperties,
  title: {
    margin: '0 0 8px',
    fontSize: '1.25rem',
    fontWeight: 600,
  } as React.CSSProperties,
  message: {
    margin: '0 0 8px',
    fontSize: '0.95rem',
    color: '#595959',
  } as React.CSSProperties,
  hint: {
    margin: '0 0 12px',
    fontSize: '0.875rem',
    color: '#8c8c8c',
  } as React.CSSProperties,
  details: {
    marginTop: '12px',
    marginBottom: '12px',
    fontSize: '0.8rem',
    color: '#595959',
  } as React.CSSProperties,
  pre: {
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    background: '#f5f5f5',
    padding: '8px',
    borderRadius: '4px',
    fontSize: '0.75rem',
  } as React.CSSProperties,
  actions: {
    display: 'flex',
    gap: '12px',
    marginTop: '16px',
    flexWrap: 'wrap' as const,
  } as React.CSSProperties,
  primaryButton: {
    padding: '8px 18px',
    cursor: 'pointer',
    backgroundColor: '#cf1322',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '0.9rem',
  } as React.CSSProperties,
  secondaryButton: {
    padding: '8px 18px',
    cursor: 'pointer',
    backgroundColor: '#fff',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    fontSize: '0.9rem',
  } as React.CSSProperties,
};

export default FrontendGlobalErrorBoundary;
