/**
 * @title FrontendHeaderResponsive
 * @notice Sticky top-level navigation bar with structured, bounded logging.
 * @dev Accepts optional `logBound` and `logger` props for dependency injection.
 *      Clamping of invalid `logBound` fields runs once via `useMemo` at
 *      component initialisation. No global logger singleton is used.
 * @custom:security No user-supplied HTML is injected into the DOM.
 *                  All dynamic content derives from typed props.
 */

import React, { useMemo, useRef, useState } from "react";
import {
  LogBound,
  Logger,
  BoundedLogger,
  DEFAULT_LOG_BOUND,
  LogLevel,
  SUPPORTED_NETWORKS,
  truncateWalletAddress,
  resolveNetworkLabel,
} from "../utils/frontend_header_responsive";

// ---------------------------------------------------------------------------
// WalletBadgeState
// ---------------------------------------------------------------------------

/**
 * @notice Enumeration of wallet badge connection states.
 */
export type WalletBadgeState =
  | "pending"
  | "connecting"
  | "connected"
  | "disconnected";

// ---------------------------------------------------------------------------
// Stellar base32 validation regex
// ---------------------------------------------------------------------------

/** Matches a valid 56-character Stellar base32 address. */
const STELLAR_BASE32_RE = /^[A-Z2-7]{56}$/;

/** Matches any character outside the Stellar base32 alphabet. */
const STELLAR_DISALLOWED_RE = /[^A-Z2-7]/;

// ---------------------------------------------------------------------------
// validateWalletAddress — exported pure helper (testable without React)
// ---------------------------------------------------------------------------

/**
 * @notice Validates a raw wallet address string against the Stellar base32
 *         alphabet (`[A-Z2-7]`) and the required 56-character length.
 * @dev Emits `warn` category `"security"` for disallowed characters, and
 *      `warn` category `"wallet"` for wrong length. Returns the truncated
 *      display address on success, or `null` on failure.
 *      The raw address is never included in any LogEntry.
 * @param address The raw wallet address string to validate.
 * @param logger  Optional logger to receive warn entries.
 * @returns The truncated display address (`"G...XXXX"`) if valid, or `null`.
 * @custom:security The raw wallet address is never stored in any LogEntry
 *                  message or meta value. No meta key named "walletAddress"
 *                  is ever emitted.
 */
export function validateWalletAddress(
  address: string,
  logger?: Logger,
): string | null {
  // Check for disallowed characters first (security check)
  if (STELLAR_DISALLOWED_RE.test(address)) {
    if (logger) {
      logger.emit({
        timestamp: new Date().toISOString(),
        level: LogLevel.warn,
        category: "security",
        message:
          "walletAddress contains disallowed characters; treating as absent",
        meta: { reason: "disallowed_characters" },
      });
    }
    return null;
  }

  // Check length (must be exactly 56 characters)
  if (address.length !== 56) {
    if (logger) {
      logger.emit({
        timestamp: new Date().toISOString(),
        level: LogLevel.warn,
        category: "wallet",
        message: "walletAddress has invalid length; treating as absent",
        meta: { reason: "invalid_address_length", length: address.length },
      });
    }
    return null;
  }

  // Valid address — return truncated form only
  return truncateWalletAddress(address);
}

// ---------------------------------------------------------------------------
// emitWalletStateChange — exported pure helper (testable without React)
// ---------------------------------------------------------------------------

/**
 * @notice Emits a wallet state change log entry when the wallet badge state
 *         transitions from one value to another.
 * @dev Emits `info` category `"wallet"` with `{ from, to }` in meta.
 *      When `displayAddress` is provided (valid truncated address), it is
 *      included in meta under the key `"displayAddress"`.
 *      The raw wallet address is never included in any LogEntry.
 * @param from           The previous wallet badge state.
 * @param to             The new wallet badge state.
 * @param displayAddress Optional truncated display address (`"G...XXXX"`).
 * @param logger         The logger to receive the info entry.
 * @custom:security Only the truncated display address is included in meta.
 *                  The raw wallet address is never stored.
 */
export function emitWalletStateChange(
  from: WalletBadgeState | null,
  to: WalletBadgeState,
  displayAddress: string | null,
  logger: Logger,
): void {
  const meta: Record<string, unknown> = { from, to };
  if (displayAddress !== null) {
    meta["displayAddress"] = displayAddress;
  }
  logger.emit({
    timestamp: new Date().toISOString(),
    level: LogLevel.info,
    category: "wallet",
    message: `Wallet state transition: ${from ?? "none"} → ${to}`,
    meta,
  });
}

// ---------------------------------------------------------------------------
// clampLogBound — exported pure helper (testable without React)
// ---------------------------------------------------------------------------

/**
 * @notice Clamps each field of a `LogBound` to its minimum valid value,
 *         emitting a `warn`-level entry with category `"config"` for each
 *         field that required clamping.
 * @dev Clamping order: maxEntriesPerCycle first, then maxEntriesPerWindow
 *      (which depends on the already-clamped maxEntriesPerCycle), then windowMs.
 * @param bound  The raw `LogBound` to validate and clamp.
 * @param logger The logger to receive warn entries for each clamped field.
 * @returns A new `LogBound` with all fields clamped to valid values.
 */
export function clampLogBound(bound: LogBound, logger: Logger): LogBound {
  let { maxEntriesPerCycle, maxEntriesPerWindow, windowMs } = bound;
  const now = new Date().toISOString();

  // Clamp maxEntriesPerCycle < 1 → 1
  if (maxEntriesPerCycle < 1) {
    logger.emit({
      timestamp: now,
      level: LogLevel.warn,
      category: "config",
      message: "logBound.maxEntriesPerCycle was less than 1; clamped to 1",
      meta: {
        field: "maxEntriesPerCycle",
        received: maxEntriesPerCycle,
        clamped: 1,
      },
    });
    maxEntriesPerCycle = 1;
  }

  // Clamp maxEntriesPerWindow < maxEntriesPerCycle → maxEntriesPerCycle
  if (maxEntriesPerWindow < maxEntriesPerCycle) {
    logger.emit({
      timestamp: now,
      level: LogLevel.warn,
      category: "config",
      message:
        "logBound.maxEntriesPerWindow was less than maxEntriesPerCycle; clamped to maxEntriesPerCycle",
      meta: {
        field: "maxEntriesPerWindow",
        received: maxEntriesPerWindow,
        clamped: maxEntriesPerCycle,
      },
    });
    maxEntriesPerWindow = maxEntriesPerCycle;
  }

  // Clamp windowMs < 1 → 1
  if (windowMs < 1) {
    logger.emit({
      timestamp: now,
      level: LogLevel.warn,
      category: "config",
      message: "logBound.windowMs was less than 1; clamped to 1",
      meta: { field: "windowMs", received: windowMs, clamped: 1 },
    });
    windowMs = 1;
  }

  return { maxEntriesPerCycle, maxEntriesPerWindow, windowMs };
}

// ---------------------------------------------------------------------------
// handleToggleMenu — exported pure helper (testable without React)
// ---------------------------------------------------------------------------

/**
 * @notice Toggles the mobile menu open/closed state and emits structured log
 *         entries for the toggle event and callback invocation.
 * @dev Emits `info` category `"menu"` with `{ newState }` on every invocation.
 *      Emits `debug` category `"menu"` with `{ callbackFired: true, newState }`
 *      when `onToggleMenu` is provided and invoked, or `{ callbackFired: false }`
 *      when it is not provided.
 * @param currentState  The current boolean open/closed state of the menu.
 * @param onToggleMenu  Optional callback invoked with the new state.
 * @param logger        The logger to receive the emitted entries.
 * @returns The new toggled boolean state.
 * @custom:security No user-supplied HTML is injected. All values are typed booleans.
 */
export function handleToggleMenu(
  currentState: boolean,
  onToggleMenu: ((isOpen: boolean) => void) | undefined,
  logger: Logger,
): boolean {
  const newState = !currentState;

  // Emit info entry for the toggle event (Requirement 6.1)
  logger.emit({
    timestamp: new Date().toISOString(),
    level: LogLevel.info,
    category: "menu",
    message: `Menu toggled to ${newState ? "open" : "closed"}`,
    meta: { newState },
  });

  if (onToggleMenu !== undefined) {
    // Callback provided — invoke it and emit debug entry (Requirement 6.2)
    onToggleMenu(newState);
    logger.emit({
      timestamp: new Date().toISOString(),
      level: LogLevel.debug,
      category: "menu",
      message: "onToggleMenu callback fired",
      meta: { callbackFired: true, newState },
    });
  } else {
    // No callback — emit debug entry indicating it was not fired (Requirement 6.3)
    logger.emit({
      timestamp: new Date().toISOString(),
      level: LogLevel.debug,
      category: "menu",
      message: "onToggleMenu callback not provided",
      meta: { callbackFired: false },
    });
  }

  return newState;
}

// ---------------------------------------------------------------------------
// FrontendHeaderResponsiveProps
// ---------------------------------------------------------------------------

/**
 * @notice Props accepted by the `FrontendHeaderResponsive` component.
 */
export interface FrontendHeaderResponsiveProps {
  /**
   * @param logBound Optional emission limits for the component's logger.
   *                 Defaults to `DEFAULT_LOG_BOUND` when omitted.
   *                 Invalid field values are clamped with a warn log entry.
   */
  logBound?: LogBound;

  /**
   * @param logger Optional Logger instance to inject (e.g. a test double).
   *               When absent, a `BoundedLogger` is created with the resolved bound.
   */
  logger?: Logger;

  /**
   * @param walletAddress Optional raw Stellar wallet address string.
   *                      Must match `[A-Z2-7]{56}` to be considered valid.
   *                      Invalid addresses are treated as absent.
   *                      The raw value is never included in any LogEntry.
   */
  walletAddress?: string;

  /**
   * @param networkName Optional network name string.
   *                    Must match `[a-z\-]+` and be in `SUPPORTED_NETWORKS`.
   *                    Invalid or unsupported names are treated as unknown.
   *                    The raw value is never included in any LogEntry.
   */
  networkName?: string;

  /**
   * @param walletBadgeState Optional current wallet badge connection state.
   *                         When this value changes between renders, a wallet
   *                         state change log entry is emitted.
   */
  walletBadgeState?: WalletBadgeState;

  /**
   * @param onToggleMenu Optional callback invoked with the new open/closed
   *                     boolean state whenever the mobile menu is toggled.
   */
  onToggleMenu?: (isOpen: boolean) => void;

  /**
   * @param isMenuOpen Optional controlled initial open state for the mobile
   *                   menu. When omitted, the component manages state internally
   *                   starting from `false` (closed).
   */
  isMenuOpen?: boolean;
}

// ---------------------------------------------------------------------------
// FrontendHeaderResponsive component
// ---------------------------------------------------------------------------

/**
 * @title FrontendHeaderResponsive
 * @notice Sticky top-level navigation bar with structured, bounded logging.
 * @dev The resolved logger is exposed via the `data-testid="fhr-root"` element
 *      for integration tests. For unit testing of logging behaviour, prefer
 *      injecting a logger via the `logger` prop.
 * @param props `FrontendHeaderResponsiveProps`
 */
export function FrontendHeaderResponsive(
  props: FrontendHeaderResponsiveProps,
): React.ReactElement {
  const {
    logBound = DEFAULT_LOG_BOUND,
    logger: loggerProp,
    walletAddress,
    networkName,
    walletBadgeState,
    onToggleMenu,
    isMenuOpen: isMenuOpenProp,
  } = props;

  // Internal menu open/closed state (starts from prop or false)
  const [menuOpen, setMenuOpen] = useState<boolean>(isMenuOpenProp ?? false);

  // Clamp logBound fields once at initialisation.
  // A temporary BoundedLogger captures the warn entries produced during clamping,
  // then the real logger is created with the resolved (clamped) bound.
  const resolvedLogger = useMemo(() => {
    // Use the injected logger if provided; otherwise create a temporary one
    // to capture clamping warnings, then build the real logger.
    if (loggerProp) {
      // Clamp into the injected logger directly.
      clampLogBound(logBound, loggerProp);
      return loggerProp;
    }

    // No injected logger: clamp first using a temp logger, then build the real one.
    const tempLogger = new BoundedLogger({
      maxEntriesPerCycle: 100,
      maxEntriesPerWindow: 100,
      windowMs: 60000,
    });
    const resolvedBound = clampLogBound(logBound, tempLogger);
    const realLogger = new BoundedLogger(resolvedBound);
    // Replay clamping warn entries into the real logger.
    for (const entry of tempLogger.getEntries()) {
      realLogger.emit(entry);
    }
    return realLogger;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Validate wallet address (security + length checks)
  const displayAddress =
    walletAddress !== undefined
      ? validateWalletAddress(walletAddress, resolvedLogger)
      : null;

  // Validate network name (security + allowlist checks)
  const resolvedNetwork =
    networkName !== undefined
      ? resolveNetworkLabel(networkName, resolvedLogger)
      : null;

  // Track previous walletBadgeState to detect transitions
  const prevWalletStateRef = useRef<WalletBadgeState | null>(null);

  if (
    walletBadgeState !== undefined &&
    walletBadgeState !== prevWalletStateRef.current
  ) {
    emitWalletStateChange(
      prevWalletStateRef.current,
      walletBadgeState,
      displayAddress,
      resolvedLogger,
    );
    prevWalletStateRef.current = walletBadgeState;
  }

  // Menu toggle handler — delegates to the pure handleToggleMenu helper
  const onMenuToggle = () => {
    const newState = handleToggleMenu(menuOpen, onToggleMenu, resolvedLogger);
    setMenuOpen(newState);
  };

  return (
    <header data-testid="fhr-root">
      {/* FrontendHeaderResponsive — content rendered by subsequent tasks */}
      <button data-testid="fhr-menu-toggle" onClick={onMenuToggle} />
    </header>
  );
}

export default FrontendHeaderResponsive;
