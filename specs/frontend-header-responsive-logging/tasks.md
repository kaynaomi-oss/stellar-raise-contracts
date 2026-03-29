# Implementation Plan: Add Logging Bounds to Frontend Header Responsive Styling

## Overview

Implement a structured, bounded logging subsystem for `FrontendHeaderResponsive` and its companion utility. The work proceeds in layers: types and core logger first, then utility instrumentation, then component instrumentation, then tests, then documentation.

## Tasks

- [ ] 1. Define logging types and implement BoundedLogger
  - [ ] 1.1 Create `LogLevel` enum, `LogEntry`, `LogBound`, and `Logger` interface in `frontend/utils/frontend_header_responsive.tsx`
    - Add `LogLevel`, `LogEntry`, `LogBound`, `Logger` with NatSpec `@notice`/`@param` JSDoc on every exported symbol
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 8.6_
  - [ ] 1.2 Implement `BoundedLogger` class with sliding-window enforcement and HTML sanitisation in `meta`
    - Implement `emit`, `getEntries`, `reset`, `getDroppedCount`; sanitise `meta` strings (`<[^>]+>` → `"[REDACTED_HTML]"`); sliding window via `windowStart`/`windowCount`
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 1.8, 9.3_
  - [ ]\* 1.3 Write property test for LogEntry shape invariant (Property 1)
    - **Property 1: Emitted entries conform to LogEntry shape**
    - **Validates: Requirements 1.2, 1.4**
  - [ ]\* 1.4 Write property test for emit/getEntries containment (Property 2)
    - **Property 2: emit then getEntries containment**
    - **Validates: Requirements 1.4, 1.6**
  - [ ]\* 1.5 Write property test for window overflow and droppedCount (Property 3)
    - **Property 3: Window overflow drops entries and increments droppedCount**
    - **Validates: Requirements 1.5, 1.8, 6.4**
  - [ ]\* 1.6 Write property test for reset restoring initial state (Property 4)
    - **Property 4: reset restores initial state**
    - **Validates: Requirements 1.7**

- [ ] 2. Implement LogBound clamping and prop wiring in the component
  - [ ] 2.1 Add `logBound` and `logger` props to `FrontendHeaderResponsiveProps` in `frontend/components/frontend_header_responsive.tsx`
    - Add NatSpec `@param` tags for both new props; default `logBound` to `DEFAULT_LOG_BOUND`; instantiate `BoundedLogger` when `logger` prop is absent
    - _Requirements: 2.1, 2.2, 2.6, 8.1, 8.2_
  - [ ] 2.2 Implement clamping logic for `logBound` fields inside a `useMemo` at component initialisation
    - Clamp `maxEntriesPerCycle < 1` → 1, `maxEntriesPerWindow < maxEntriesPerCycle` → `maxEntriesPerCycle`, `windowMs < 1` → 1; emit `warn` category `"config"` for each clamped field
    - _Requirements: 2.3, 2.4, 2.5_
  - [ ]\* 2.3 Write property test for LogBound clamping (Property 5)
    - **Property 5: LogBound clamping emits warn entries**
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5**

- [ ] 3. Instrument BreakpointValidator with validation logging
  - [ ] 3.1 Add optional `logger?: Logger` parameter to `isValidBreakpoint`, `isValidLayoutMode`, and `isValidVisibilityState` in `frontend/utils/frontend_header_responsive.tsx`
    - Emit `error`-level entry with category `"validation"` and `meta: { field, received, allowed }` before throwing; sanitise `received` (replace non-`[A-Za-z0-9_\-]` chars with `"[REDACTED]"`)
    - Add `@throws`, `@custom:security` NatSpec tags
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 8.3, 8.4, 8.5_
  - [ ]\* 3.2 Write property test for validator error logging before throw (Property 12)
    - **Property 12: Validator error logging before throw**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

- [ ] 4. Instrument updateBreakpoint with breakpoint transition logging
  - [ ] 4.1 Update `updateBreakpoint(width, logger?)` in `frontend/utils/frontend_header_responsive.tsx` to emit structured log entries
    - Emit `warn` for `width <= 0` (`{ invalidWidth }`) and `width > 10000` (`{ clampedWidth }`); emit `info` on breakpoint change (`{ from, to, width }`); emit `debug` on no change (`{ current, width }`)
    - Add `@notice`, `@returns`, `@custom:security` NatSpec tags
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 8.3_
  - [ ]\* 4.2 Write property test for breakpoint transition logging (Property 6)
    - **Property 6: Breakpoint transition logging**
    - **Validates: Requirements 3.1, 3.2**
  - [ ]\* 4.3 Write property test for invalid width bounds (Property 7)
    - **Property 7: Invalid width bounds emit warn entries**
    - **Validates: Requirements 3.3, 3.4**

- [ ] 5. Checkpoint — ensure all tests pass so far
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Instrument wallet address and network name handling
  - [ ] 6.1 Add Stellar base32 validation (`[A-Z2-7]`) and `networkName` allowlist check (`[a-z\-]`) in `frontend/components/frontend_header_responsive.tsx`
    - Emit `warn` category `"security"` for disallowed characters; treat invalid address as absent; treat invalid network as unknown
    - Add `@custom:security` NatSpec tags to `truncateWalletAddress` and `resolveNetworkLabel`
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 9.1, 9.2, 8.5_
  - [ ] 6.2 Emit wallet state change log entries on `walletBadgeState` transitions
    - Use `useRef` to track previous state; emit `info` category `"wallet"` with `{ from, to }` on change; include `displayAddress` (truncated) in `meta` when address is valid
    - _Requirements: 4.1, 4.3_
  - [ ]\* 6.3 Write property test for raw wallet address never in entries (Property 8)
    - **Property 8: Raw wallet address never appears in any LogEntry**
    - **Validates: Requirements 4.2, 9.4**
  - [ ]\* 6.4 Write property test for valid address truncation form (Property 9)
    - **Property 9: Valid wallet address truncated to displayAddress form**
    - **Validates: Requirements 4.3**
  - [ ]\* 6.5 Write property test for wallet state change logging (Property 10)
    - **Property 10: Wallet state change logging**
    - **Validates: Requirements 4.1**
  - [ ]\* 6.6 Write property test for invalid address and unknown network warn entries (Property 11)
    - **Property 11: Invalid wallet address and unknown network emit warn entries**
    - **Validates: Requirements 4.4, 4.5**
  - [ ]\* 6.7 Write property test for security allowlist validation (Property 15)
    - **Property 15: Security — Stellar base32 and networkName allowlist**
    - **Validates: Requirements 9.1, 9.2**

- [ ] 7. Instrument mobile menu toggle logging
  - [ ] 7.1 Add log emission inside `handleToggleMenu` in `frontend/components/frontend_header_responsive.tsx`
    - Emit `info` category `"menu"` with `{ newState }`; emit `debug` with `{ callbackFired: true, newState }` when `onToggleMenu` is provided, `{ callbackFired: false }` otherwise
    - _Requirements: 6.1, 6.2, 6.3_
  - [ ]\* 7.2 Write property test for menu toggle logging (Property 13)
    - **Property 13: Menu toggle logging**
    - **Validates: Requirements 6.1, 6.2, 6.3**

- [ ] 8. Implement and test LogEntry JSON round-trip and HTML sanitisation
  - [ ] 8.1 Verify `BoundedLogger.emit` enforces JSON-serialisable `meta` (no `undefined`, `Symbol`, `Function`, `BigInt`, circular refs) — add runtime guard if needed
    - _Requirements: 7.3_
  - [ ]\* 8.2 Write property test for LogEntry JSON round-trip (Property 14)
    - **Property 14: LogEntry JSON round-trip**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
  - [ ]\* 8.3 Write property test for HTML sanitisation in meta (Property 16)
    - **Property 16: HTML sanitisation in meta**
    - **Validates: Requirements 9.3**

- [ ] 9. Add NatSpec JSDoc to all remaining exported symbols
  - [ ] 9.1 Audit `frontend/components/frontend_header_responsive.tsx` for missing `@title`, `@notice`, `@dev`, `@param` tags on the component function and all props
    - _Requirements: 8.1, 8.2_
  - [ ] 9.2 Audit `frontend/utils/frontend_header_responsive.tsx` for missing `@notice`, `@returns`, `@throws`, `@custom:security` tags on every exported function and method
    - _Requirements: 8.3, 8.4, 8.5_

- [ ] 10. Write unit tests for concrete examples and edge cases
  - [ ] 10.1 Write unit tests in `frontend/components/frontend_header_responsive.test.tsx` covering: default `logBound` when prop omitted, all four `WalletBadgeState` transitions, zero-width viewport, max-width viewport, HTML injection in `networkName`, `droppedCount` increment on window overflow
    - _Requirements: 10.1, 10.3, 10.4, 10.5_
  - [ ] 10.2 Write security-focused unit tests verifying raw wallet addresses never appear in any emitted `LogEntry`
    - _Requirements: 10.4_

- [ ] 11. Write developer documentation
  - [ ] 11.1 Create `frontend/components/frontend_header_responsive.md` with API reference, usage examples, and a "Test Output" section showing representative expected console output for each major test group
    - _Requirements: 10.6_

- [ ] 12. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each property test must include the comment `// Feature: frontend-header-responsive-logging, Property N: <property_text>` and run a minimum of 100 iterations via fast-check
- All property tests live in `frontend/components/frontend_header_responsive.test.tsx`
- No global logger singleton — the component owns or receives its `Logger` instance via props
