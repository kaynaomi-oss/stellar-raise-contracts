/**
 * @title Frontend Header Responsive — Logging Subsystem
 * @notice Provides structured, bounded logging types and the default BoundedLogger
 *         implementation for the FrontendHeaderResponsive component and its utilities.
 * @dev All exported symbols carry NatSpec-style JSDoc. No global singleton is used;
 *      callers own or inject their Logger instance.
 */

// ---------------------------------------------------------------------------
// LogLevel
// ---------------------------------------------------------------------------

/**
 * @notice Severity levels for structured log entries.
 */
export enum LogLevel {
  debug = "debug",
  info = "info",
  warn = "warn",
  error = "error",
}

// ---------------------------------------------------------------------------
// LogEntry
// ---------------------------------------------------------------------------

/**
 * @notice A single structured log record emitted by the logging subsystem.
 * @dev All string values in `meta` are HTML-sanitised before storage.
 *      `timestamp` must be a valid ISO-8601 string.
 *      `meta` values must be JSON-serialisable (no undefined, Symbol, Function,
 *      BigInt, or circular references).
 */
export interface LogEntry {
  /** @notice ISO-8601 timestamp string produced at emission time. */
  timestamp: string;
  /** @notice Severity level of this entry. */
  level: LogLevel;
  /** @notice Logical category grouping this entry (e.g. "breakpoint", "wallet"). */
  category: string;
  /** @notice Human-readable description of the event. */
  message: string;
  /** @notice Optional structured metadata. All string values are HTML-sanitised. */
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// LogBound
// ---------------------------------------------------------------------------

/**
 * @notice Declares upper limits on log emission to prevent log-flood DoS.
 * @param maxEntriesPerCycle Maximum entries emitted per render cycle (positive integer).
 * @param maxEntriesPerWindow Maximum entries emitted within `windowMs` (positive integer).
 * @param windowMs Time window in milliseconds (positive integer).
 */
export interface LogBound {
  /** @notice Maximum entries emitted per render cycle. */
  maxEntriesPerCycle: number;
  /** @notice Maximum entries emitted within the sliding time window. */
  maxEntriesPerWindow: number;
  /** @notice Duration of the sliding time window in milliseconds. */
  windowMs: number;
}

// ---------------------------------------------------------------------------
// Logger interface
// ---------------------------------------------------------------------------

/**
 * @notice The logging contract consumed by FrontendHeaderResponsive and its utilities.
 * @dev Implementations must be safe to call from React render paths (no throws on emit).
 */
export interface Logger {
  /**
   * @notice Record a log entry, subject to bound enforcement.
   * @param entry The structured log entry to record.
   */
  emit(entry: LogEntry): void;

  /**
   * @notice Return all non-dropped entries in emission order.
   * @returns A readonly array of stored LogEntry objects.
   */
  getEntries(): readonly LogEntry[];

  /**
   * @notice Clear all stored entries and reset droppedCount to zero.
   */
  reset(): void;

  /**
   * @notice Return the number of entries dropped due to bound overflow.
   * @returns Current droppedCount value.
   */
  getDroppedCount(): number;
}

// ---------------------------------------------------------------------------
// DEFAULT_LOG_BOUND
// ---------------------------------------------------------------------------

/**
 * @notice Default log bound applied when no `logBound` prop is provided.
 */
export const DEFAULT_LOG_BOUND: LogBound = {
  maxEntriesPerCycle: 10,
  maxEntriesPerWindow: 100,
  windowMs: 1000,
};

// ---------------------------------------------------------------------------
// HTML sanitisation helper
// ---------------------------------------------------------------------------

/**
 * @notice Replaces all HTML tag substrings (matching `<[^>]+>`) in a string
 *         with the literal `"[REDACTED_HTML]"`.
 * @param value The raw string to sanitise.
 * @returns The sanitised string with HTML tags replaced.
 */
function sanitiseHtml(value: string): string {
  return value.replace(/<[^>]+>/g, "[REDACTED_HTML]");
}

/**
 * @notice Recursively strips non-JSON-serialisable values from a meta object.
 *         `undefined`, `Symbol`, `Function`, and `BigInt` values are omitted.
 *         Circular references are detected via a `seen` WeakSet and omitted.
 * @param meta The raw meta record to sanitise.
 * @param seen WeakSet used to detect circular references (internal use).
 * @returns A new meta record containing only JSON-serialisable values.
 */
function sanitiseMetaForJson(
  meta: Record<string, unknown>,
  seen: WeakSet<object> = new WeakSet(),
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(meta)) {
    const value = meta[key];
    const t = typeof value;
    // Omit non-serialisable primitives
    if (
      t === "undefined" ||
      t === "symbol" ||
      t === "function" ||
      t === "bigint"
    ) {
      continue;
    }
    if (value !== null && t === "object") {
      // Detect circular references
      if (seen.has(value as object)) {
        continue;
      }
      seen.add(value as object);
      if (Array.isArray(value)) {
        result[key] = (value as unknown[]).reduce<unknown[]>((acc, item) => {
          const it = typeof item;
          if (
            it === "undefined" ||
            it === "symbol" ||
            it === "function" ||
            it === "bigint"
          ) {
            // omit non-serialisable array items
          } else if (item !== null && it === "object") {
            if (!seen.has(item as object)) {
              seen.add(item as object);
              acc.push(
                sanitiseMetaForJson(item as Record<string, unknown>, seen),
              );
            }
          } else {
            acc.push(item);
          }
          return acc;
        }, []);
      } else {
        result[key] = sanitiseMetaForJson(
          value as Record<string, unknown>,
          seen,
        );
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * @notice Recursively sanitises all string values inside a meta object,
 *         replacing HTML tag substrings with `"[REDACTED_HTML]"`.
 * @param meta The raw meta record to sanitise.
 * @returns A new meta record with all string values sanitised.
 */
function sanitiseMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(meta)) {
    const value = meta[key];
    if (typeof value === "string") {
      result[key] = sanitiseHtml(value);
    } else if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      result[key] = sanitiseMeta(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === "string" ? sanitiseHtml(item) : item,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// BoundedLogger
// ---------------------------------------------------------------------------

/**
 * @notice Default in-memory Logger implementation with sliding-window rate limiting
 *         and HTML sanitisation of `meta` string values.
 * @dev Maintains an internal entries array, a droppedCount counter, and a sliding
 *      window tracked by `windowStart` (epoch ms) and `windowCount`.
 *      `emit` never throws — overflow is handled silently via droppedCount.
 */
export class BoundedLogger implements Logger {
  private readonly bound: LogBound;
  private entries: LogEntry[] = [];
  private droppedCount: number = 0;
  private windowStart: number = Date.now();
  private windowCount: number = 0;

  /**
   * @notice Construct a BoundedLogger with the given emission limits.
   * @param bound The LogBound configuration to enforce.
   */
  constructor(bound: LogBound = DEFAULT_LOG_BOUND) {
    this.bound = bound;
  }

  /**
   * @notice Record a log entry, subject to sliding-window bound enforcement.
   *         If the window limit is exceeded, the entry is dropped and droppedCount
   *         is incremented. All string values in `meta` are HTML-sanitised.
   * @param entry The structured log entry to record.
   */
  emit(entry: LogEntry): void {
    const now = Date.now();

    // Advance the window if the current window has elapsed.
    if (now - this.windowStart >= this.bound.windowMs) {
      this.windowStart = now;
      this.windowCount = 0;
    }

    // Drop if window limit exceeded.
    if (this.windowCount >= this.bound.maxEntriesPerWindow) {
      this.droppedCount += 1;
      return;
    }

    // Strip non-JSON-serialisable values, then sanitise HTML in strings.
    const sanitisedEntry: LogEntry =
      entry.meta !== undefined
        ? { ...entry, meta: sanitiseMeta(sanitiseMetaForJson(entry.meta)) }
        : entry;

    this.entries.push(sanitisedEntry);
    this.windowCount += 1;
  }

  /**
   * @notice Return all non-dropped entries in emission order.
   * @returns A readonly array of stored LogEntry objects.
   */
  getEntries(): readonly LogEntry[] {
    return this.entries;
  }

  /**
   * @notice Clear all stored entries and reset droppedCount to zero.
   */
  reset(): void {
    this.entries = [];
    this.droppedCount = 0;
    this.windowStart = Date.now();
    this.windowCount = 0;
  }

  /**
   * @notice Return the number of entries dropped due to bound overflow.
   * @returns Current droppedCount value.
   */
  getDroppedCount(): number {
    return this.droppedCount;
  }
}

// ---------------------------------------------------------------------------
// Breakpoint resolution
// ---------------------------------------------------------------------------

/** Breakpoint width thresholds (upper-exclusive). */
const BREAKPOINT_CONFIGS: Array<{ name: string; maxWidth: number }> = [
  { name: "mobile", maxWidth: 480 },
  { name: "tablet", maxWidth: 768 },
  { name: "desktop", maxWidth: 1024 },
  { name: "wide", maxWidth: 1440 },
];

/**
 * @notice Resolves a clamped viewport width to its named breakpoint.
 * @param clampedWidth A width value already clamped to [1, 10000].
 * @returns The breakpoint name: "mobile" | "tablet" | "desktop" | "wide" | "ultra-wide".
 */
function resolveBreakpointName(clampedWidth: number): string {
  for (const { name, maxWidth } of BREAKPOINT_CONFIGS) {
    if (clampedWidth < maxWidth) return name;
  }
  return "ultra-wide";
}

/**
 * @notice Resolves the current breakpoint name from a raw viewport width,
 *         emitting structured log entries for width anomalies and breakpoint
 *         transitions via the optional logger.
 * @param width             Raw viewport width in pixels (may be out of range).
 * @param previousBreakpoint The breakpoint name resolved on the previous call,
 *                           or `null` on the first call.
 * @param logger            Optional logger to receive structured log entries.
 * @returns The resolved breakpoint name after clamping.
 * @custom:security This function does NOT include raw wallet addresses or network
 *                  names in any emitted log entry. Only numeric width values and
 *                  breakpoint name strings are included in meta.
 */
export function updateBreakpoint(
  width: number,
  previousBreakpoint: string | null,
  logger?: Logger,
): string {
  let clampedWidth = width;

  // Warn and clamp widths <= 0.
  if (width <= 0) {
    if (logger) {
      logger.emit({
        timestamp: new Date().toISOString(),
        level: LogLevel.warn,
        category: "breakpoint",
        message: `Invalid width value: ${width}. Clamping to 1.`,
        meta: { invalidWidth: width },
      });
    }
    clampedWidth = 1;
  } else if (width > 10000) {
    // Warn and clamp widths > 10000.
    if (logger) {
      logger.emit({
        timestamp: new Date().toISOString(),
        level: LogLevel.warn,
        category: "breakpoint",
        message: `Width ${width} exceeds maximum. Clamping to 10000.`,
        meta: { clampedWidth: width },
      });
    }
    clampedWidth = 10000;
  }

  const resolved = resolveBreakpointName(clampedWidth);

  if (previousBreakpoint !== resolved) {
    // Breakpoint changed — emit info.
    if (logger) {
      logger.emit({
        timestamp: new Date().toISOString(),
        level: LogLevel.info,
        category: "breakpoint",
        message: `Breakpoint transition: ${previousBreakpoint ?? "none"} → ${resolved}`,
        meta: { from: previousBreakpoint, to: resolved, width: clampedWidth },
      });
    }
  } else {
    // Breakpoint unchanged — emit debug.
    if (logger) {
      logger.emit({
        timestamp: new Date().toISOString(),
        level: LogLevel.debug,
        category: "breakpoint",
        message: `Breakpoint unchanged: ${resolved}`,
        meta: { current: resolved, width: clampedWidth },
      });
    }
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Wallet address and network name helpers
// ---------------------------------------------------------------------------

/**
 * @notice Supported network names for the Stellar network.
 * @dev Used by `resolveNetworkLabel` to validate the `networkName` prop against
 *      an explicit allowlist. Any name not in this list is treated as unknown.
 */
export const SUPPORTED_NETWORKS = ["mainnet", "testnet", "futurenet"] as const;

/**
 * @notice Truncates a valid Stellar wallet address to the display form `"G...XXXX"`.
 * @dev Only the last 4 characters of the address are included. The raw address
 *      is never stored or emitted in any LogEntry.
 * @param address A 56-character Stellar base32 address (`[A-Z2-7]{56}`).
 * @returns The truncated display form `"G..." + last4chars`.
 * @custom:security This function must only be called after the address has been
 *                  validated against `[A-Z2-7]{56}`. The raw address must never
 *                  appear in any LogEntry message or meta value.
 */
export function truncateWalletAddress(address: string): string {
  return "G..." + address.slice(-4);
}

/**
 * @notice Resolves a network name to a display label, validating it against the
 *         supported networks allowlist and the `[a-z\-]` character allowlist.
 * @dev If `networkName` contains characters outside `[a-z\-]`, a `warn`-level
 *      entry with category `"security"` is emitted and `"unknown"` is returned.
 *      If `networkName` is not in `SUPPORTED_NETWORKS`, a `warn`-level entry
 *      with category `"wallet"` is emitted and `"unknown"` is returned.
 *      The raw `networkName` value is never included in any LogEntry.
 * @param networkName The raw network name string to resolve.
 * @param logger      Optional logger to receive warn entries.
 * @returns The validated network name, or `"unknown"` if invalid or unsupported.
 * @custom:security The raw `networkName` value is never stored in any LogEntry.
 *                  Only the string `"unknown"` or the validated name is used.
 */
export function resolveNetworkLabel(
  networkName: string,
  logger?: Logger,
): string {
  // Validate character allowlist [a-z\-]
  if (/[^a-z\-]/.test(networkName)) {
    if (logger) {
      logger.emit({
        timestamp: new Date().toISOString(),
        level: LogLevel.warn,
        category: "security",
        message:
          "networkName contains disallowed characters; treating as unknown",
        meta: { reason: "disallowed_characters" },
      });
    }
    return "unknown";
  }

  // Validate against supported networks allowlist
  if (!(SUPPORTED_NETWORKS as readonly string[]).includes(networkName)) {
    if (logger) {
      logger.emit({
        timestamp: new Date().toISOString(),
        level: LogLevel.warn,
        category: "wallet",
        message:
          "networkName is not in SUPPORTED_NETWORKS; treating as unknown",
        meta: { reason: "unknown_network" },
      });
    }
    return "unknown";
  }

  return networkName;
}

// ---------------------------------------------------------------------------
// FrontendHeaderResponsiveError
// ---------------------------------------------------------------------------

/**
 * @notice Custom error thrown by BreakpointValidator when an invalid value
 *         is supplied to a validation method.
 * @dev Always preceded by an `error`-level LogEntry with category `"validation"`.
 */
export class FrontendHeaderResponsiveError extends Error {
  /**
   * @notice Construct a FrontendHeaderResponsiveError with the given message.
   * @param message Human-readable description of the validation failure.
   */
  constructor(message: string) {
    super(message);
    this.name = "FrontendHeaderResponsiveError";
  }
}

// ---------------------------------------------------------------------------
// BreakpointValidator
// ---------------------------------------------------------------------------

/** Valid breakpoint identifiers. */
const VALID_BREAKPOINTS = [
  "mobile",
  "tablet",
  "desktop",
  "wide",
  "ultra-wide",
] as const;

/** Valid layout mode identifiers. */
const VALID_LAYOUT_MODES = ["stacked", "inline", "overlay"] as const;

/** Valid visibility state identifiers. */
const VALID_VISIBILITY_STATES = ["visible", "hidden", "collapsed"] as const;

/**
 * @notice Sanitises a `received` value for inclusion in validation log meta.
 * @dev If the value contains any character outside `[A-Za-z0-9_\-]`, the entire
 *      value is replaced with the literal string `"[REDACTED]"`.
 * @param value The raw received value to sanitise.
 * @returns The original value if safe, otherwise `"[REDACTED]"`.
 */
function sanitiseReceived(value: string): string {
  return /[^A-Za-z0-9_\-]/.test(value) ? "[REDACTED]" : value;
}

/**
 * @notice Static validator class for breakpoint, layout mode, and visibility
 *         state values used by the FrontendHeaderResponsive subsystem.
 * @dev Each method accepts an optional `logger` parameter. When provided and
 *      validation fails, an `error`-level LogEntry with category `"validation"`
 *      is emitted before the error is thrown.
 */
export class BreakpointValidator {
  /**
   * @notice Validates that `breakpoint` is one of the recognised breakpoint identifiers.
   * @param breakpoint The value to validate.
   * @param logger     Optional logger to receive the error-level validation entry.
   * @returns `true` when the value is valid.
   * @throws {FrontendHeaderResponsiveError} When `breakpoint` is not a valid identifier.
   * @custom:security The `received` value in log meta is sanitised: any character
   *                  outside `[A-Za-z0-9_\-]` causes the entire value to be replaced
   *                  with `"[REDACTED]"` to prevent log injection.
   */
  static isValidBreakpoint(breakpoint: string, logger?: Logger): true {
    const allowed = [...VALID_BREAKPOINTS];
    if (!(allowed as string[]).includes(breakpoint)) {
      if (logger) {
        logger.emit({
          timestamp: new Date().toISOString(),
          level: LogLevel.error,
          category: "validation",
          message: `Invalid breakpoint: "${sanitiseReceived(breakpoint)}"`,
          meta: {
            field: "breakpoint",
            received: sanitiseReceived(breakpoint),
            allowed,
          },
        });
      }
      throw new FrontendHeaderResponsiveError(
        `Invalid breakpoint: "${breakpoint}". Allowed: ${allowed.join(", ")}`,
      );
    }
    return true;
  }

  /**
   * @notice Validates that `layoutMode` is one of the recognised layout mode identifiers.
   * @param layoutMode The value to validate.
   * @param logger     Optional logger to receive the error-level validation entry.
   * @returns `true` when the value is valid.
   * @throws {FrontendHeaderResponsiveError} When `layoutMode` is not a valid identifier.
   * @custom:security The `received` value in log meta is sanitised: any character
   *                  outside `[A-Za-z0-9_\-]` causes the entire value to be replaced
   *                  with `"[REDACTED]"` to prevent log injection.
   */
  static isValidLayoutMode(layoutMode: string, logger?: Logger): true {
    const allowed = [...VALID_LAYOUT_MODES];
    if (!(allowed as string[]).includes(layoutMode)) {
      if (logger) {
        logger.emit({
          timestamp: new Date().toISOString(),
          level: LogLevel.error,
          category: "validation",
          message: `Invalid layoutMode: "${sanitiseReceived(layoutMode)}"`,
          meta: {
            field: "layoutMode",
            received: sanitiseReceived(layoutMode),
            allowed,
          },
        });
      }
      throw new FrontendHeaderResponsiveError(
        `Invalid layoutMode: "${layoutMode}". Allowed: ${allowed.join(", ")}`,
      );
    }
    return true;
  }

  /**
   * @notice Validates that `visibility` is one of the recognised visibility state identifiers.
   * @param visibility The value to validate.
   * @param logger     Optional logger to receive the error-level validation entry.
   * @returns `true` when the value is valid.
   * @throws {FrontendHeaderResponsiveError} When `visibility` is not a valid identifier.
   * @custom:security The `received` value in log meta is sanitised: any character
   *                  outside `[A-Za-z0-9_\-]` causes the entire value to be replaced
   *                  with `"[REDACTED]"` to prevent log injection.
   */
  static isValidVisibilityState(visibility: string, logger?: Logger): true {
    const allowed = [...VALID_VISIBILITY_STATES];
    if (!(allowed as string[]).includes(visibility)) {
      if (logger) {
        logger.emit({
          timestamp: new Date().toISOString(),
          level: LogLevel.error,
          category: "validation",
          message: `Invalid visibilityState: "${sanitiseReceived(visibility)}"`,
          meta: {
            field: "visibilityState",
            received: sanitiseReceived(visibility),
            allowed,
          },
        });
      }
      throw new FrontendHeaderResponsiveError(
        `Invalid visibilityState: "${visibility}". Allowed: ${allowed.join(", ")}`,
      );
    }
    return true;
  }
}
