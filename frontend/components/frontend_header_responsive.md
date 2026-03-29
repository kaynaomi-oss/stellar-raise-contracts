# FrontendHeaderResponsive — Developer Reference

Structured, bounded logging subsystem for the sticky top-level navigation bar.
Both source files carry NatSpec-style JSDoc on every exported symbol.

---

## Table of Contents

1. [Component exports](#component-exports)
2. [Utility exports](#utility-exports)
3. [Usage examples](#usage-examples)
4. [Test Output](#test-output)

---

## Component exports

`frontend/components/frontend_header_responsive.tsx`

### `FrontendHeaderResponsive`

```ts
function FrontendHeaderResponsive(
  props: FrontendHeaderResponsiveProps,
): React.ReactElement;
```

Sticky top-level navigation bar with structured, bounded logging.
Accepts an optional `logger` prop for dependency injection and an optional
`logBound` prop to control emission limits. No global logger singleton is used.

### `FrontendHeaderResponsiveProps`

| Prop               | Type                                   | Default                            | Description                                                                                                                |
| ------------------ | -------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `logBound`         | `LogBound` (optional)                  | `DEFAULT_LOG_BOUND`                | Emission limits. Invalid fields are clamped with a `warn` log entry.                                                       |
| `logger`           | `Logger` (optional)                    | `new BoundedLogger(resolvedBound)` | Injected logger (e.g. a test double).                                                                                      |
| `walletAddress`    | `string` (optional)                    | —                                  | Raw Stellar address (`[A-Z2-7]{56}`). Invalid values are treated as absent; the raw value never appears in any `LogEntry`. |
| `networkName`      | `string` (optional)                    | —                                  | Network name (`[a-z-]+`). Must be in `SUPPORTED_NETWORKS`. Invalid or unsupported values are treated as unknown.           |
| `walletBadgeState` | `WalletBadgeState` (optional)          | —                                  | Current wallet badge state. A state-change entry is emitted on each transition.                                            |
| `onToggleMenu`     | `(isOpen: boolean) => void` (optional) | —                                  | Callback invoked with the new open/closed state on each menu toggle.                                                       |
| `isMenuOpen`       | `boolean` (optional)                   | `false`                            | Controlled initial open state for the mobile menu.                                                                         |

### `WalletBadgeState`

```ts
type WalletBadgeState = "pending" | "connecting" | "connected" | "disconnected";
```

Enumeration of wallet badge connection states.

### `clampLogBound`

```ts
function clampLogBound(bound: LogBound, logger: Logger): LogBound;
```

Clamps each field of a `LogBound` to its minimum valid value, emitting a
`warn`-level entry with category `"config"` for each field that required clamping.

| Field                 | Invalid condition      | Clamped to           |
| --------------------- | ---------------------- | -------------------- |
| `maxEntriesPerCycle`  | `< 1`                  | `1`                  |
| `maxEntriesPerWindow` | `< maxEntriesPerCycle` | `maxEntriesPerCycle` |
| `windowMs`            | `< 1`                  | `1`                  |

### `handleToggleMenu`

```ts
function handleToggleMenu(
  currentState: boolean,
  onToggleMenu: ((isOpen: boolean) => void) | undefined,
  logger: Logger,
): boolean;
```

Toggles the mobile menu open/closed state and emits:

- `info` category `"menu"` with `{ newState }` on every invocation.
- `debug` category `"menu"` with `{ callbackFired: true, newState }` when `onToggleMenu` is provided.
- `debug` category `"menu"` with `{ callbackFired: false }` when `onToggleMenu` is absent.

Returns the new toggled boolean state.

### `validateWalletAddress`

```ts
function validateWalletAddress(address: string, logger?: Logger): string | null;
```

Validates a raw wallet address against the Stellar base32 alphabet (`[A-Z2-7]`)
and the required 56-character length.

- Disallowed characters: emits `warn` category `"security"`, returns `null`.
- Wrong length: emits `warn` category `"wallet"` with `{ reason: "invalid_address_length", length }`, returns `null`.
- Valid: returns the truncated display form `"G...XXXX"`. The raw address is never stored.

### `emitWalletStateChange`

```ts
function emitWalletStateChange(
  from: WalletBadgeState | null,
  to: WalletBadgeState,
  displayAddress: string | null,
  logger: Logger,
): void;
```

Emits an `info`-level entry with category `"wallet"` and `{ from, to }` in `meta`.
When `displayAddress` is provided (truncated form only), it is included under the
key `"displayAddress"`. The raw wallet address is never stored.

---

## Utility exports

`frontend/utils/frontend_header_responsive.tsx`

### `LogLevel`

```ts
enum LogLevel {
  debug = "debug",
  info = "info",
  warn = "warn",
  error = "error",
}
```

Severity levels for structured log entries.

### `LogEntry`

```ts
interface LogEntry {
  timestamp: string; // ISO-8601
  level: LogLevel;
  category: string;
  message: string;
  meta?: Record<string, unknown>;
}
```

A single structured log record. All string values in `meta` are HTML-sanitised
before storage (`<[^>]+>` replaced with `"[REDACTED_HTML]"`). `meta` values must be
JSON-serialisable (no `undefined`, `Symbol`, `Function`, `BigInt`, or circular refs).

### `LogBound`

```ts
interface LogBound {
  maxEntriesPerCycle: number; // max entries per render cycle (positive integer)
  maxEntriesPerWindow: number; // max entries within windowMs (positive integer)
  windowMs: number; // sliding window duration in ms (positive integer)
}
```

Declares upper limits on log emission to prevent log-flood DoS.

### `Logger`

```ts
interface Logger {
  emit(entry: LogEntry): void;
  getEntries(): readonly LogEntry[];
  reset(): void;
  getDroppedCount(): number;
}
```

The logging contract consumed by `FrontendHeaderResponsive` and its utilities.
Implementations must be safe to call from React render paths (no throws on `emit`).

| Method            | Description                                                  |
| ----------------- | ------------------------------------------------------------ |
| `emit`            | Records a log entry, subject to bound enforcement.           |
| `getEntries`      | Returns all non-dropped entries in emission order.           |
| `reset`           | Clears all stored entries and resets `droppedCount` to zero. |
| `getDroppedCount` | Returns the number of entries dropped due to bound overflow. |

### `BoundedLogger`

```ts
class BoundedLogger implements Logger {
  constructor(bound?: LogBound);
}
```

Default in-memory `Logger` implementation with sliding-window rate limiting and
HTML sanitisation of `meta` string values.

**Sliding-window algorithm:**

1. On each `emit`, advance the window if `Date.now() - windowStart >= windowMs`.
2. If `windowCount >= maxEntriesPerWindow`, increment `droppedCount` and return.
3. Strip non-JSON-serialisable values from `meta`, then sanitise HTML in strings.
4. Push the entry and increment `windowCount`.

`emit` never throws — overflow is handled silently via `droppedCount`.

### `DEFAULT_LOG_BOUND`

```ts
const DEFAULT_LOG_BOUND: LogBound = {
  maxEntriesPerCycle: 10,
  maxEntriesPerWindow: 100,
  windowMs: 1000,
};
```

Default bound applied when no `logBound` prop is provided.

### `updateBreakpoint`

```ts
function updateBreakpoint(
  width: number,
  previousBreakpoint: string | null,
  logger?: Logger,
): string;
```

Resolves the current breakpoint name from a raw viewport width, emitting
structured log entries for width anomalies and breakpoint transitions.

| Condition            | Entry emitted                                   |
| -------------------- | ----------------------------------------------- |
| `width <= 0`         | `warn` `"breakpoint"` `{ invalidWidth: width }` |
| `width > 10000`      | `warn` `"breakpoint"` `{ clampedWidth: width }` |
| Breakpoint changed   | `info` `"breakpoint"` `{ from, to, width }`     |
| Breakpoint unchanged | `debug` `"breakpoint"` `{ current, width }`     |

Returns the resolved breakpoint name: `"mobile"` | `"tablet"` | `"desktop"` | `"wide"` | `"ultra-wide"`.

### `truncateWalletAddress`

```ts
function truncateWalletAddress(address: string): string;
```

Truncates a valid 56-character Stellar address to `"G..." + last4chars`.
Must only be called after the address has been validated against `[A-Z2-7]{56}`.
The raw address must never appear in any `LogEntry`.

### `resolveNetworkLabel`

```ts
function resolveNetworkLabel(networkName: string, logger?: Logger): string;
```

Resolves a network name to a display label, validating against `[a-z-]` and
the `SUPPORTED_NETWORKS` allowlist. Returns `"unknown"` for invalid or unsupported
names. The raw `networkName` value is never included in any `LogEntry`.

### `SUPPORTED_NETWORKS`

```ts
const SUPPORTED_NETWORKS = ["mainnet", "testnet", "futurenet"] as const;
```

Allowlist of recognised Stellar network names.

### `FrontendHeaderResponsiveError`

```ts
class FrontendHeaderResponsiveError extends Error {
  constructor(message: string);
}
```

Custom error thrown by `BreakpointValidator` when an invalid value is supplied.
Always preceded by an `error`-level `LogEntry` with category `"validation"`.

### `BreakpointValidator`

```ts
class BreakpointValidator {
  static isValidBreakpoint(breakpoint: string, logger?: Logger): true;
  static isValidLayoutMode(layoutMode: string, logger?: Logger): true;
  static isValidVisibilityState(visibility: string, logger?: Logger): true;
}
```

Static validator class. Each method emits an `error`-level entry with category
`"validation"` and `meta: { field, received, allowed }` before throwing
`FrontendHeaderResponsiveError` for invalid values.

The `received` value in `meta` is sanitised: any character outside `[A-Za-z0-9_-]`
causes the entire value to be replaced with `"[REDACTED]"` to prevent log injection.

| Method                   | Valid values                                                  |
| ------------------------ | ------------------------------------------------------------- |
| `isValidBreakpoint`      | `"mobile"`, `"tablet"`, `"desktop"`, `"wide"`, `"ultra-wide"` |
| `isValidLayoutMode`      | `"stacked"`, `"inline"`, `"overlay"`                          |
| `isValidVisibilityState` | `"visible"`, `"hidden"`, `"collapsed"`                        |

---

## Usage examples

### Inject a logger

```tsx
import { BoundedLogger } from "../utils/frontend_header_responsive";
import { FrontendHeaderResponsive } from "./frontend_header_responsive";

const logger = new BoundedLogger({
  maxEntriesPerCycle: 10,
  maxEntriesPerWindow: 100,
  windowMs: 1000,
});

<FrontendHeaderResponsive
  logger={logger}
  walletBadgeState="connected"
  walletAddress="GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW"
  networkName="mainnet"
/>;

// Inspect emitted entries after render
console.log(logger.getEntries());
console.log("Dropped:", logger.getDroppedCount());
```

### Configure logBound

```tsx
<FrontendHeaderResponsive
  logBound={{ maxEntriesPerCycle: 5, maxEntriesPerWindow: 50, windowMs: 500 }}
  walletBadgeState="pending"
/>
```

Invalid fields are clamped automatically. Passing
`{ maxEntriesPerCycle: 0, maxEntriesPerWindow: 5, windowMs: 500 }` clamps
`maxEntriesPerCycle` to `1` and emits a `warn` entry with category `"config"`.

### Inspect emitted entries

```ts
import { BoundedLogger, LogLevel } from "../utils/frontend_header_responsive";

const logger = new BoundedLogger();

// ... trigger component interactions ...

const entries = logger.getEntries();

// Filter by level
const warnings = entries.filter((e) => e.level === LogLevel.warn);

// Filter by category
const walletEvents = entries.filter((e) => e.category === "wallet");

// Inspect a specific entry
const [first] = entries;
console.log(first.timestamp); // "2024-01-15T10:30:00.000Z"
console.log(first.level); // "info"
console.log(first.category); // "breakpoint"
console.log(first.message); // "Breakpoint transition: none → mobile"
console.log(first.meta); // { from: null, to: "mobile", width: 375 }

// Reset between test cases
logger.reset();
console.log(logger.getEntries().length); // 0
console.log(logger.getDroppedCount()); // 0
```

### Use clampLogBound standalone

```ts
import {
  BoundedLogger,
  clampLogBound,
} from "../utils/frontend_header_responsive";

const logger = new BoundedLogger({
  maxEntriesPerCycle: 100,
  maxEntriesPerWindow: 100,
  windowMs: 60000,
});
const resolved = clampLogBound(
  { maxEntriesPerCycle: -5, maxEntriesPerWindow: 10, windowMs: 0 },
  logger,
);
// resolved → { maxEntriesPerCycle: 1, maxEntriesPerWindow: 10, windowMs: 1 }
// logger.getEntries() contains two warn entries (maxEntriesPerCycle and windowMs)
```

### Use BreakpointValidator with a logger

```ts
import {
  BoundedLogger,
  BreakpointValidator,
  FrontendHeaderResponsiveError,
} from "../utils/frontend_header_responsive";

const logger = new BoundedLogger();
try {
  BreakpointValidator.isValidBreakpoint("invalid-bp", logger);
} catch (err) {
  if (err instanceof FrontendHeaderResponsiveError) {
    const entry = logger.getEntries()[0];
    // entry.level    → "error"
    // entry.category → "validation"
    // entry.meta     → { field: "breakpoint", received: "invalid-bp", allowed: [...] }
  }
}
```

---

## Test Output

Representative expected console output for each major test group in
`frontend/components/frontend_header_responsive.test.tsx`.

### BoundedLogger

```
✓ [unit] starts with empty entries and zero droppedCount
✓ [unit] stores an emitted entry
✓ [unit] reset clears entries and droppedCount
✓ [unit] sanitises HTML tags in meta string values
✓ [unit] droppedCount increments when window limit exceeded
✓ [property] Property 1: emitted entries conform to LogEntry shape
✓ [property] Property 2: emit/getEntries containment
✓ [property] Property 3: window overflow drops entries and increments droppedCount
✓ [property] Property 4: reset restores initial state
```

Sample entry produced by `[unit] stores an emitted entry`:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "category": "test",
  "message": "hello"
}
```

Sample entry produced by `[unit] sanitises HTML tags in meta string values`:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "warn",
  "category": "security",
  "message": "injection attempt",
  "meta": { "value": "[REDACTED_HTML]alert(1)[REDACTED_HTML]" }
}
```

---

### LogBound clamping

```
✓ [unit] default bound is applied when logBound prop is omitted
✓ [unit] valid bound passes through unchanged with no warn entries
✓ [unit] maxEntriesPerCycle < 1 is clamped to 1 with warn
✓ [unit] maxEntriesPerWindow < maxEntriesPerCycle is clamped with warn
✓ [unit] windowMs < 1 is clamped to 1 with warn
✓ [property] Property 5: LogBound clamping emits warn entries for each invalid field
```

Sample warn entry for `maxEntriesPerCycle < 1`:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "warn",
  "category": "config",
  "message": "logBound.maxEntriesPerCycle was less than 1; clamped to 1",
  "meta": { "field": "maxEntriesPerCycle", "received": 0, "clamped": 1 }
}
```

Sample warn entry for `maxEntriesPerWindow < maxEntriesPerCycle`:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "warn",
  "category": "config",
  "message": "logBound.maxEntriesPerWindow was less than maxEntriesPerCycle; clamped to maxEntriesPerCycle",
  "meta": { "field": "maxEntriesPerWindow", "received": 5, "clamped": 10 }
}
```

---

### Validation logging (BreakpointValidator)

```
✓ [property] Property 12: validator error logging before throw
✓ [unit] isValidBreakpoint throws without logger when no logger provided
✓ [unit] isValidBreakpoint returns true for valid values
✓ [unit] isValidLayoutMode returns true for valid values
✓ [unit] isValidVisibilityState returns true for valid values
✓ [unit] received value with special chars is REDACTED in meta
✓ [unit] received value with only safe chars is preserved in meta
```

Sample error entry for `isValidBreakpoint("not-a-breakpoint", logger)`:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "error",
  "category": "validation",
  "message": "Invalid breakpoint: \"not-a-breakpoint\"",
  "meta": {
    "field": "breakpoint",
    "received": "not-a-breakpoint",
    "allowed": ["mobile", "tablet", "desktop", "wide", "ultra-wide"]
  }
}
```

Sample error entry for `isValidBreakpoint("<script>xss</script>", logger)`:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "error",
  "category": "validation",
  "message": "Invalid breakpoint: \"[REDACTED]\"",
  "meta": {
    "field": "breakpoint",
    "received": "[REDACTED]",
    "allowed": ["mobile", "tablet", "desktop", "wide", "ultra-wide"]
  }
}
```

---

### Breakpoint transition logging

```
✓ [property] Property 6: breakpoint transition logging
✓ [property] Property 7: invalid width bounds emit warn entries
✓ [unit] emits info on breakpoint change (mobile → tablet)
✓ [unit] emits debug on no breakpoint change
✓ [unit] emits warn for width <= 0 (zero-width viewport)
✓ [unit] emits warn for width > 10000 (max-width viewport)
✓ [unit] does not include wallet address or network name in breakpoint entries
✓ [unit] first call with null previous emits info entry
```

Sample info entry for `updateBreakpoint(600, "mobile", logger)`:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "category": "breakpoint",
  "message": "Breakpoint transition: mobile → tablet",
  "meta": { "from": "mobile", "to": "tablet", "width": 600 }
}
```

Sample debug entry for `updateBreakpoint(300, "mobile", logger)`:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "debug",
  "category": "breakpoint",
  "message": "Breakpoint unchanged: mobile",
  "meta": { "current": "mobile", "width": 300 }
}
```

Sample warn entry for `updateBreakpoint(0, null, logger)`:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "warn",
  "category": "breakpoint",
  "message": "Invalid width value: 0. Clamping to 1.",
  "meta": { "invalidWidth": 0 }
}
```

Sample warn entry for `updateBreakpoint(10001, null, logger)`:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "warn",
  "category": "breakpoint",
  "message": "Width 10001 exceeds maximum. Clamping to 10000.",
  "meta": { "clampedWidth": 10001 }
}
```

---

### Wallet logging

```
✓ [property] Property 8: raw wallet address never appears in any LogEntry
✓ [property] Property 9: valid wallet address truncated to displayAddress form
✓ [property] Property 10: wallet state change logging
✓ [property] Property 11: invalid address and unknown network emit warn entries
✓ [property] Property 15: security allowlist validation
✓ [unit] truncateWalletAddress returns G... + last 4 chars
✓ [unit] validateWalletAddress returns null for address with disallowed chars
✓ [unit] validateWalletAddress returns null for wrong-length address
✓ [unit] validateWalletAddress returns displayAddress for valid 56-char address
✓ [unit] resolveNetworkLabel returns network for valid supported network
✓ [unit] resolveNetworkLabel returns unknown for unsupported network
✓ [unit] resolveNetworkLabel returns unknown for network with disallowed chars (HTML injection)
✓ [unit] emitWalletStateChange emits info entry with from/to
✓ [unit] emitWalletStateChange includes displayAddress when provided
✓ [unit] all four WalletBadgeState transitions are logged correctly
```

Sample info entry for `emitWalletStateChange("pending", "connecting", null, logger)`:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "category": "wallet",
  "message": "Wallet state transition: pending → connecting",
  "meta": { "from": "pending", "to": "connecting" }
}
```

Sample info entry with `displayAddress`:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "category": "wallet",
  "message": "Wallet state transition: connecting → connected",
  "meta": {
    "from": "connecting",
    "to": "connected",
    "displayAddress": "G...WXYZ"
  }
}
```

Sample warn entry for a wrong-length address:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "warn",
  "category": "wallet",
  "message": "walletAddress has invalid length; treating as absent",
  "meta": { "reason": "invalid_address_length", "length": 6 }
}
```

Sample warn entry for an address with disallowed characters:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "warn",
  "category": "security",
  "message": "walletAddress contains disallowed characters; treating as absent",
  "meta": { "reason": "disallowed_characters" }
}
```

Sample warn entry for an unknown network:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "warn",
  "category": "wallet",
  "message": "networkName is not in SUPPORTED_NETWORKS; treating as unknown",
  "meta": { "reason": "unknown_network" }
}
```

---

### Menu toggle logging

```
✓ [property] Property 13: menu toggle logging
✓ [unit] handleToggleMenu toggles false → true and emits info + debug entries
✓ [unit] handleToggleMenu toggles true → false and emits info + debug entries
✓ [unit] handleToggleMenu fires callback and emits callbackFired: true
```

Sample entries for `handleToggleMenu(false, undefined, logger)`:

```json
[
  {
    "timestamp": "2024-01-15T10:30:00.000Z",
    "level": "info",
    "category": "menu",
    "message": "Menu toggled to open",
    "meta": { "newState": true }
  },
  {
    "timestamp": "2024-01-15T10:30:00.000Z",
    "level": "debug",
    "category": "menu",
    "message": "onToggleMenu callback not provided",
    "meta": { "callbackFired": false }
  }
]
```

Sample entries for `handleToggleMenu(false, cb, logger)` (callback provided):

```json
[
  {
    "timestamp": "2024-01-15T10:30:00.000Z",
    "level": "info",
    "category": "menu",
    "message": "Menu toggled to open",
    "meta": { "newState": true }
  },
  {
    "timestamp": "2024-01-15T10:30:00.000Z",
    "level": "debug",
    "category": "menu",
    "message": "onToggleMenu callback fired",
    "meta": { "callbackFired": true, "newState": true }
  }
]
```

---

### Serialisation

```
✓ [property] Property 14: LogEntry JSON round-trip
```

Every `LogEntry` produced by `BoundedLogger` survives a JSON round-trip intact:

```ts
const entry = logger.getEntries()[0];

// Deep equality after round-trip
const rt = JSON.parse(JSON.stringify(entry));
// rt.timestamp === entry.timestamp, rt.level === entry.level, etc.

// Timestamp survives Date round-trip
new Date(entry.timestamp).toISOString() === entry.timestamp; // true

// Idempotent serialisation
const once = JSON.stringify(JSON.parse(JSON.stringify(entry)));
const twice = JSON.stringify(
  JSON.parse(JSON.stringify(JSON.parse(JSON.stringify(entry)))),
);
once === twice; // true
```

---

### Security — HTML sanitisation

```
✓ [property] Property 16: HTML sanitisation in meta
✓ [unit] sanitises HTML tags in meta string values
✓ [unit] raw address never appears in message or meta for disallowed-char address
✓ [unit] raw address never appears in message or meta for wrong-length address
✓ [unit] no meta key named walletAddress is ever emitted
✓ [unit] displayAddress in meta is truncated form, not raw address
```

Any string value in `meta` containing an HTML tag is sanitised before storage.
Each matched tag (`<[^>]+>`) is replaced individually with `"[REDACTED_HTML]"`;
text between tags is preserved.

Input meta:

```json
{ "value": "<script>alert(1)</script>" }
```

Stored meta:

```json
{ "value": "[REDACTED_HTML]alert(1)[REDACTED_HTML]" }
```

The `"walletAddress"` key is never emitted in any `LogEntry`. Only the truncated
`displayAddress` (`"G...XXXX"`) may appear in wallet-related entries.
