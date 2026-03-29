# Requirements Document

## Introduction

This feature adds structured logging bounds to the `FrontendHeaderResponsive` component and its companion utility (`frontend/utils/frontend_header_responsive.tsx`). The goal is to improve developer experience and documentation quality by capturing breakpoint transitions, wallet state changes, validation outcomes, and security-relevant events in a structured, bounded log — without leaking sensitive data or degrading rendering performance.

The deliverables are:

- Updated `frontend/components/frontend_header_responsive.tsx` with NatSpec-style comments and inline logging hooks
- Updated `frontend/utils/frontend_header_responsive.tsx` with logging bounds on all public methods
- Comprehensive test suite `frontend/components/frontend_header_responsive.test.tsx`
- Developer documentation `frontend/components/frontend_header_responsive.md`

---

## Glossary

- **Header**: The `FrontendHeaderResponsive` React component that renders the sticky top-level navigation bar.
- **Logger**: The structured logging subsystem responsible for emitting bounded log entries from the Header and its utility.
- **LogEntry**: A single structured record emitted by the Logger, containing a timestamp, severity level, event category, and a sanitised message payload.
- **LogBound**: A declared upper limit on the number of LogEntries the Logger may emit per render cycle or per time window, preventing log-flood denial-of-service.
- **Breakpoint**: A named viewport-width threshold (`mobile`, `tablet`, `desktop`, `wide`, `ultra-wide`) defined in `BREAKPOINT_CONFIGS`.
- **WalletBadgeState**: One of four enumerated states (`pending`, `connecting`, `connected`, `disconnected`) derived from the component's props.
- **SanitisedPayload**: A log message string from which wallet addresses, network names, and other PII have been redacted or truncated before emission.
- **NatSpec**: Ethereum-style structured documentation comments (`@title`, `@notice`, `@dev`, `@param`, `@returns`, `@custom:*`) applied to TypeScript/TSX source.
- **RoundTrip**: The property that serialising a LogEntry to JSON and deserialising it back produces an equivalent LogEntry.
- **Validator**: The `BreakpointValidator` static class in the utility module.
- **ResizeObserver**: The browser API used by `FrontendHeaderResponsive.initialize()` to detect viewport changes.

---

## Requirements

### Requirement 1: Structured Logger Interface

**User Story:** As a developer, I want a typed Logger interface for the Header subsystem, so that I can instrument log calls without coupling to a specific logging backend.

#### Acceptance Criteria

1. THE Logger SHALL define a `LogLevel` enumeration with values `debug`, `info`, `warn`, and `error`.
2. THE Logger SHALL define a `LogEntry` interface containing: `timestamp` (ISO-8601 string), `level` (LogLevel), `category` (string), `message` (string), and an optional `meta` (Record<string, unknown>).
3. THE Logger SHALL define a `LogBound` interface containing: `maxEntriesPerCycle` (positive integer) and `maxEntriesPerWindow` (positive integer) and `windowMs` (positive integer milliseconds).
4. THE Logger SHALL expose an `emit(entry: LogEntry): void` method that records the entry.
5. WHEN `emit` is called and the number of entries in the current window exceeds `maxEntriesPerWindow`, THE Logger SHALL drop the entry and increment an internal `droppedCount` counter instead of throwing.
6. THE Logger SHALL expose a `getEntries(): readonly LogEntry[]` method returning all non-dropped entries in emission order.
7. THE Logger SHALL expose a `reset(): void` method that clears all stored entries and resets `droppedCount` to zero.
8. THE Logger SHALL expose a `getDroppedCount(): number` method returning the current `droppedCount`.

---

### Requirement 2: Log Bounds Configuration

**User Story:** As a developer, I want configurable log bounds on the Header component, so that I can prevent log-flood attacks and control verbosity in production.

#### Acceptance Criteria

1. THE Header SHALL accept an optional `logBound` prop of type `LogBound`.
2. WHEN `logBound` is omitted, THE Header SHALL apply a default bound of `{ maxEntriesPerCycle: 10, maxEntriesPerWindow: 100, windowMs: 1000 }`.
3. WHEN `logBound.maxEntriesPerCycle` is less than 1, THE Header SHALL clamp the value to 1 and emit a `warn`-level LogEntry with category `"config"`.
4. WHEN `logBound.maxEntriesPerWindow` is less than `logBound.maxEntriesPerCycle`, THE Header SHALL clamp `maxEntriesPerWindow` to equal `maxEntriesPerCycle` and emit a `warn`-level LogEntry with category `"config"`.
5. WHEN `logBound.windowMs` is less than 1, THE Header SHALL clamp the value to 1 and emit a `warn`-level LogEntry with category `"config"`.
6. THE Header SHALL accept an optional `logger` prop of type `Logger` to allow injection of a test double.

---

### Requirement 3: Breakpoint Transition Logging

**User Story:** As a developer, I want breakpoint transitions logged with structured metadata, so that I can diagnose responsive layout issues in development and staging.

#### Acceptance Criteria

1. WHEN `FrontendHeaderResponsive.updateBreakpoint(width)` is called and the resolved breakpoint differs from the previous breakpoint, THE Logger SHALL emit an `info`-level LogEntry with category `"breakpoint"` containing `{ from, to, width }` in `meta`.
2. WHEN `updateBreakpoint` is called and the breakpoint does not change, THE Logger SHALL emit a `debug`-level LogEntry with category `"breakpoint"` containing `{ current, width }` in `meta`.
3. WHEN `updateBreakpoint` is called with a width less than or equal to zero, THE Logger SHALL emit a `warn`-level LogEntry with category `"breakpoint"` containing `{ invalidWidth: width }` in `meta` before clamping.
4. WHEN `updateBreakpoint` is called with a width greater than 10000, THE Logger SHALL emit a `warn`-level LogEntry with category `"breakpoint"` containing `{ clampedWidth: width }` in `meta` before clamping.
5. THE Logger SHALL NOT include raw wallet addresses or network names in breakpoint LogEntries.

---

### Requirement 4: Wallet State Change Logging

**User Story:** As a developer, I want wallet badge state transitions logged, so that I can trace connection lifecycle issues without exposing sensitive wallet data.

#### Acceptance Criteria

1. WHEN the `walletBadgeState` derived value changes between renders, THE Header SHALL emit an `info`-level LogEntry with category `"wallet"` containing `{ from, to }` in `meta`.
2. THE Logger SHALL NOT include the raw `walletAddress` value in any LogEntry `message` or `meta` field.
3. WHEN `walletAddress` is present and valid, THE Logger SHALL include only the truncated form (`G...XXXX`) in `meta` under the key `"displayAddress"`.
4. WHEN `walletAddress` is present but invalid (wrong length), THE Logger SHALL emit a `warn`-level LogEntry with category `"wallet"` containing `{ reason: "invalid_address_length", length: <actual_length> }` in `meta`.
5. WHEN `networkName` is provided and not in `SUPPORTED_NETWORKS`, THE Logger SHALL emit a `warn`-level LogEntry with category `"wallet"` containing `{ reason: "unknown_network" }` in `meta` — the raw `networkName` value SHALL NOT appear in the LogEntry.

---

### Requirement 5: Validation Logging in BreakpointValidator

**User Story:** As a developer, I want validation failures in `BreakpointValidator` to produce structured log entries, so that I can identify misconfigured breakpoint usage at runtime.

#### Acceptance Criteria

1. WHEN `BreakpointValidator.isValidBreakpoint(breakpoint)` is called with an invalid value, THE Validator SHALL emit an `error`-level LogEntry with category `"validation"` before throwing `FrontendHeaderResponsiveError`.
2. WHEN `BreakpointValidator.isValidLayoutMode(layoutMode)` is called with an invalid value, THE Validator SHALL emit an `error`-level LogEntry with category `"validation"` before throwing.
3. WHEN `BreakpointValidator.isValidVisibilityState(visibility)` is called with an invalid value, THE Validator SHALL emit an `error`-level LogEntry with category `"validation"` before throwing.
4. THE LogEntry `meta` for validation failures SHALL contain `{ field: <param_name>, received: <value>, allowed: <allowed_values_array> }`.
5. IF the `received` value in a validation LogEntry contains characters outside `[A-Za-z0-9_\-]`, THEN THE Logger SHALL replace the value with the string `"[REDACTED]"` in the LogEntry `meta`.

---

### Requirement 6: Mobile Menu Toggle Logging

**User Story:** As a developer, I want mobile menu toggle events logged, so that I can verify callback sequencing and detect stale-closure regressions.

#### Acceptance Criteria

1. WHEN `handleToggleMenu` is invoked, THE Header SHALL emit an `info`-level LogEntry with category `"menu"` containing `{ newState: <boolean> }` in `meta`.
2. WHEN `onToggleMenu` callback is provided and invoked, THE Header SHALL emit a `debug`-level LogEntry with category `"menu"` containing `{ callbackFired: true, newState: <boolean> }` in `meta`.
3. WHEN `onToggleMenu` callback is not provided, THE Header SHALL emit a `debug`-level LogEntry with category `"menu"` containing `{ callbackFired: false }` in `meta`.
4. THE Logger SHALL emit at most `logBound.maxEntriesPerCycle` LogEntries per render cycle across all categories.

---

### Requirement 7: LogEntry Serialisation Round-Trip

**User Story:** As a developer, I want LogEntry objects to survive JSON serialisation and deserialisation intact, so that I can persist and replay logs reliably.

#### Acceptance Criteria

1. THE Logger SHALL produce LogEntry objects where `JSON.parse(JSON.stringify(entry))` yields an object deeply equal to the original entry.
2. THE Logger SHALL ensure `timestamp` values are valid ISO-8601 strings that survive round-trip through `new Date(timestamp).toISOString()`.
3. THE Logger SHALL ensure `meta` values contain only JSON-serialisable primitives, arrays, and plain objects — no `undefined`, `Symbol`, `Function`, `BigInt`, or circular references.
4. FOR ALL valid LogEntry objects, serialising then deserialising then serialising again SHALL produce the same JSON string (idempotent serialisation).

---

### Requirement 8: NatSpec Documentation Coverage

**User Story:** As a developer, I want every exported symbol in both header files to carry NatSpec-style comments, so that I can generate accurate API documentation automatically.

#### Acceptance Criteria

1. THE Header component file SHALL include `@title`, `@notice`, and `@dev` tags on the component function.
2. THE Header component file SHALL include `@param` tags for every prop in `FrontendHeaderResponsiveProps`, including the new `logBound` and `logger` props.
3. THE utility file SHALL include `@notice` and `@returns` tags on every exported function and method.
4. THE utility file SHALL include `@throws` tags on every function that may throw `FrontendHeaderResponsiveError`.
5. THE utility file SHALL include `@custom:security` tags on `truncateWalletAddress`, `resolveNetworkLabel`, and all `BreakpointValidator` methods documenting their security assumptions.
6. THE Logger interface and all its methods SHALL include `@notice` and `@param` tags.

---

### Requirement 9: Security Assumption Validation

**User Story:** As a developer, I want security assumptions in the header subsystem to be explicitly validated and documented, so that I can audit the component's attack surface.

#### Acceptance Criteria

1. THE Header SHALL validate that `walletAddress`, when provided, contains only characters matching `[A-Z2-7]` (Stellar base32 alphabet) before truncation; IF the address contains disallowed characters, THEN THE Header SHALL treat it as invalid and emit a `warn`-level LogEntry with category `"security"`.
2. THE Header SHALL validate that `networkName`, when provided, contains only characters matching `[a-z\-]` before allowlist lookup; IF the value contains disallowed characters, THEN THE Header SHALL treat it as unknown and emit a `warn`-level LogEntry with category `"security"`.
3. THE Logger SHALL sanitise all string values in `meta` by replacing substrings matching `<[^>]+>` (HTML tags) with `"[REDACTED_HTML]"` before storing the LogEntry.
4. THE Logger SHALL NOT emit LogEntries containing the substring `"walletAddress"` as a key in `meta`.
5. THE Header SHALL document in `@custom:security` comments that no user-supplied HTML is injected into the DOM and that all dynamic content derives from typed props.

---

### Requirement 10: Test Coverage and Output Documentation

**User Story:** As a developer, I want a comprehensive test suite with documented expected outputs, so that I can verify correctness and review test results easily.

#### Acceptance Criteria

1. THE test file SHALL cover all acceptance criteria in Requirements 1–9 with at least one test case per criterion.
2. THE test file SHALL include property-based round-trip tests for LogEntry serialisation (Requirement 7).
3. THE test file SHALL include edge-case tests for: zero-width viewport, maximum-width viewport, all four `WalletBadgeState` transitions, invalid wallet address characters, and HTML-injection attempts in `networkName`.
4. THE test file SHALL include security-focused tests verifying that raw wallet addresses never appear in emitted LogEntries.
5. THE test file SHALL include a test verifying that log bounds are enforced and `droppedCount` increments correctly when the window limit is exceeded.
6. THE documentation file `frontend_header_responsive.md` SHALL include a "Test Output" section showing representative expected console output for each major test group.
