# soroban_sdk_minor

Documents the edge cases and helpers introduced for the Soroban SDK v22 minor
version bump, with a focus on frontend UI safety, scalability, and on-chain
auditability.

## Overview

`soroban_sdk_minor.rs` centralizes low-level helpers used when reviewing and
operating a minor Soroban SDK bump. All functions are explicit, testable, and
audit-friendly. The module covers:

- Version compatibility assessment
- Minor-bump detection for the frontend upgrade banner
- Frontend pagination bounds (post-SDK-upgrade safety)
- WASM hash validation before upgrade execution
- Structured on-chain audit event emission
- `SdkChangeRecord` construction for governance logs
- `emit_ping_event` — Soroban v22 auth pattern demonstration

## What Changed in v22

| Area | Before (v21) | After (v22) |
| :--- | :--- | :--- |
| Contract registration in tests | `env.register_contract(None, Contract)` | `env.register(Contract, ())` |
| Storage keys | Raw `String` values | Typed `#[contracttype]` enums |
| Auth pattern | Various | `address.require_auth()` is the standard |

## Public API

```rust
// Assess whether a version upgrade is safe for this contract's storage/ABI.
fn assess_compatibility(env, from_version, to_version) -> CompatibilityStatus

// Parse the minor component from a semver string (e.g. "22.3.0" → 3).
fn parse_minor(version) -> u32

// Returns true when to_version is a forward minor bump within the same major.
fn is_minor_bump(from_version, to_version) -> bool

// Clamp a frontend page-size request into [FRONTEND_PAGE_SIZE_MIN, FRONTEND_PAGE_SIZE_MAX].
fn clamp_page_size(requested) -> u32

// Build a bounded pagination window; saturating arithmetic prevents u32 overflow.
fn pagination_window(offset, requested_limit) -> PaginationWindow

// Validate an optional upgrade note fits within UPGRADE_NOTE_MAX_LEN (256 bytes).
fn validate_upgrade_note(note) -> bool

// Validate a WASM hash is non-zero before applying an upgrade.
fn validate_wasm_hash(wasm_hash) -> bool

// Construct a SdkChangeRecord for on-chain audit storage.
fn build_sdk_change_record(env, id, is_breaking, description) -> SdkChangeRecord

// Emit a structured SDK-upgrade audit event on the Soroban event ledger.
fn emit_upgrade_audit_event(env, from_version, to_version, reviewer)

// Emit an audit event with a bounded note; panics if note exceeds max length.
fn emit_upgrade_audit_event_with_note(env, from_version, to_version, reviewer, note)

// Emit a typed `ping` event; requires `from` to authorize (v22 auth pattern).
fn emit_ping_event(env, from, value)
```

## CompatibilityStatus

| Variant | Meaning |
|---------|---------|
| `Compatible` | Same major version; safe to upgrade |
| `RequiresMigration` | Different major versions; migration step needed |
| `Incompatible` | Empty or completely malformed version string; frontend should surface as error |

## SdkChangeRecord

Stores a structured record of a single SDK change for on-chain governance logs:

```rust
pub struct SdkChangeRecord {
    pub id: Symbol,          // Short identifier, e.g. "register_api"
    pub is_breaking: bool,   // Whether the change is breaking for this contract
    pub description: String, // Human-readable description
}
```

### Example

```rust
let record = build_sdk_change_record(
    &env,
    "register_api",
    false,
    String::from_str(&env, "env.register(Contract, ()) replaces register_contract"),
);
```

## emit_ping_event

Demonstrates the Soroban v22 auth pattern for event emission. The emitter must
authorize the call via `require_auth()`:

```rust
// Succeeds when auth is satisfied (mocked in tests, real sig on-chain).
emit_ping_event(&env, from_address, 42_i32);

// Panics without auth — only the emitter can trigger this event.
```

## Edge Cases (this PR)

### `assess_compatibility` — empty string inputs

Empty strings return `Incompatible` rather than silently mapping to major-0:

```rust
assess_compatibility(&env, "", "22.0.0")  // → Incompatible
assess_compatibility(&env, "22.0.0", "")  // → Incompatible
assess_compatibility(&env, "", "")        // → Incompatible
```

### `parse_minor` — edge cases

```rust
parse_minor("22.3.0")  // → 3
parse_minor("22")      // → 0  (no minor component)
parse_minor("22.")     // → 0  (empty minor)
parse_minor("22.x.0")  // → 0  (non-numeric)
parse_minor("")        // → 0
```

### `is_minor_bump` — edge cases

```rust
is_minor_bump("22.0.0", "22.1.0")  // → true
is_minor_bump("22.1.0", "22.1.5")  // → false (patch only)
is_minor_bump("22.1.0", "22.1.0")  // → false (same)
is_minor_bump("22.2.0", "22.1.0")  // → false (downgrade)
is_minor_bump("22.0.0", "23.1.0")  // → false (cross-major)
```

### `pagination_window` — u32::MAX overflow safety

```rust
pagination_window(u32::MAX, 50)
// → PaginationWindow { start: u32::MAX, limit: 50 }
// start.saturating_add(limit) == u32::MAX  (no wrap)
```

### `validate_upgrade_note` — exact boundary

```rust
validate_upgrade_note(&note_of_256_bytes)  // → true
validate_upgrade_note(&note_of_257_bytes)  // → false
```

## Security Assumptions

1. `assess_compatibility` is read-only — no state mutations.
2. Empty version strings return `Incompatible` rather than silently mapping to major-0.
3. `validate_wasm_hash` rejects a zeroed hash to prevent accidental contract bricking.
4. `clamp_page_size` bounds frontend scan size to prevent indexer overload after SDK upgrades.
5. `emit_upgrade_audit_event_with_note` panics on oversized notes to keep event schema predictable.
6. `emit_ping_event` requires `from.require_auth()` — only the emitter can trigger the event,
   preventing spoofed audit trails.

## NatSpec-style Reference

### `assess_compatibility`
- **@notice** Returns `Compatible`, `RequiresMigration`, or `Incompatible` based on version strings.
- **@security** Read-only; empty inputs return `Incompatible` to prevent silent major-0 mapping.

### `parse_minor`
- **@notice** Extracts the minor component from a semver string.
- **@dev** Returns `0` for any unparseable or missing minor component.

### `is_minor_bump`
- **@notice** Returns `true` only when `to_version` is a forward minor bump within the same major.
- **@dev** Pure function; no state access.

### `pagination_window`
- **@notice** Builds a bounded `PaginationWindow` from an offset and requested limit.
- **@security** Saturating arithmetic prevents `u32` overflow when `offset` is near `u32::MAX`.

### `validate_upgrade_note`
- **@notice** Returns `true` when the note fits within `UPGRADE_NOTE_MAX_LEN` (256 bytes).
- **@dev** Exact boundary (`len == max`) is accepted.

### `validate_wasm_hash`
- **@notice** Returns `true` for any non-zero 32-byte hash.
- **@security** Rejects zeroed hashes to prevent upgrade calls that would brick the contract.

### `build_sdk_change_record`
- **@notice** Constructs a `SdkChangeRecord` for on-chain audit storage.
- **@dev** `id` is stored as a compact `Symbol`; `description` is a full `String`.

### `emit_ping_event`
- **@notice** Emits a typed `ping` event demonstrating the Soroban v22 auth pattern.
- **@security** Requires `from.require_auth()` — only the emitter can trigger this event.

## Running Tests

```bash
# Run the standalone soroban-sdk-minor contract tests
cargo test -p soroban-sdk-minor

# Run the crowdfund module tests (includes soroban_sdk_minor helpers)
cargo test -p crowdfund -- soroban_sdk_minor
```

## Test Coverage Summary

| Group | Tests |
|-------|-------|
| Version constants | 1 |
| `assess_compatibility` | 12 |
| `parse_minor` | 6 |
| `is_minor_bump` | 5 |
| `validate_wasm_hash` | 4 |
| `clamp_page_size` | 1 |
| `pagination_window` | 4 |
| `validate_upgrade_note` | 3 |
| `build_sdk_change_record` | 3 |
| `emit_upgrade_audit_event` | 1 |
| `emit_upgrade_audit_event_with_note` | 3 |
| `emit_ping_event` | 6 |
| Integration | 5 |
| **Total** | **54** |

Expected coverage: ≥ 95% statements, branches, and functions.
# Soroban SDK Minor Version Bump Review

## Overview

This document covers the review and implementation of the Soroban SDK minor
version bump for the `crowdfund` smart contract, addressing
[GitHub Issue #363](https://github.com/Crowdfunding-DApp/stellar-raise-contracts/issues/363).

**Baseline:** `soroban-sdk = "22.0.0"`  
**Target:** `soroban-sdk = "22.0.1"` (workspace `Cargo.toml`)

---

## Files Changed

| File | Change |
|------|--------|
| `Cargo.toml` (workspace) | Bumped `soroban-sdk` from `22.0.0` → `22.0.1` |
| `contracts/crowdfund/src/lib.rs` | Added `pub mod soroban_sdk_minor` and test module |
| `contracts/crowdfund/src/soroban_sdk_minor.rs` | New: compatibility helpers and audit utilities |
| `contracts/crowdfund/src/soroban_sdk_minor_tests.rs` | New: comprehensive test suite (25 tests) |
| `contracts/crowdfund/src/soroban_sdk_minor.md` | New: this document |

---

## What a Minor Version Bump Means for Soroban

Soroban SDK versions are tied to Stellar Protocol versions. Within the same
major version (e.g. `22.x`):

- The **host-function ABI** is stable — compiled WASM binaries remain valid.
- The **`contracttype` storage layout** is unchanged — on-chain data is readable.
- The **`require_auth()` semantics** are identical.
- Changes are **additive**: new helpers, deprecation notices, or bug fixes.

A cross-major bump (e.g. `22.x` → `23.x`) may introduce breaking changes and
requires an explicit migration review.

---

## Security Assumptions

1. **Storage layout stability** — `#[contracttype]` ABI is frozen within a
   major version. Existing on-chain state (contributions, status, roadmap, etc.)
   remains readable after the bump.

2. **Auth model unchanged** — `require_auth()` guards on `initialize`,
   `withdraw`, `cancel`, `update_metadata`, `upgrade`, and `set_nft_contract`
   behave identically.

3. **Overflow protection preserved** — The release profile sets
   `overflow-checks = true` independently of the SDK version.

4. **WASM target flags unchanged** — `.cargo/config.toml` disables
   `reference-types` and `multivalue` for maximum host compatibility; these
   flags are not affected by a minor SDK bump.

5. **Zero-hash guard** — The `validate_wasm_hash` helper rejects a zeroed
   `BytesN<32>` to prevent accidental contract bricking during upgrades.

---

## NatSpec-Style Function Documentation

### `assess_compatibility(env, from_version, to_version) → CompatibilityStatus`

- **@param** `env` — Soroban execution environment (read-only use).
- **@param** `from_version` — Semver string of the current SDK (e.g. `"22.0.0"`).
- **@param** `to_version` — Semver string of the target SDK (e.g. `"22.0.1"`).
- **@returns** `Compatible` when major versions match; `RequiresMigration` otherwise.
- **@security** Read-only; no state mutations.

### `validate_wasm_hash(wasm_hash) → bool`

- **@param** `wasm_hash` — 32-byte WASM binary hash.
- **@returns** `true` if the hash is non-zero; `false` for a zeroed hash.
- **@security** Prevents upgrade calls with an uninitialised hash value.

### `emit_upgrade_audit_event(env, from_version, to_version, reviewer)`

- **@param** `env` — Soroban execution environment.
- **@param** `from_version` — Previous SDK version string.
- **@param** `to_version` — New SDK version string.
- **@param** `reviewer` — Address that approved the upgrade.
- **@emits** `("sdk_upgrade", "reviewed")` with `(reviewer, from_version, to_version)`.
- **@security** Provides an immutable on-chain audit trail for governance.

---

## Test Coverage

The test suite in `soroban_sdk_minor_tests.rs` contains **25 tests** covering:

- Version constant format validation
- `assess_compatibility`: same major, minor bump, patch bump, identical,
  cross-major, downgrade, malformed input, empty string, large numbers
- `validate_wasm_hash`: valid hash, zero hash, single-byte variants, all-0xFF
- `emit_upgrade_audit_event`: single event, topic symbols, multiple events
- Integration scenarios: safe path, unsafe path, partial failures

Run with:

```bash
cargo test -p crowdfund soroban_sdk_minor
```

---

## Upgrade Checklist

- [x] Bump `soroban-sdk` in `[workspace.dependencies]`
- [x] `cargo check --target wasm32-unknown-unknown` passes
- [x] All existing tests pass unchanged
- [x] New module and tests added
- [x] `CONTRACT_VERSION` constant unchanged (storage-layout guard)
- [x] `.cargo/config.toml` WASM flags verified unchanged
- [x] Security assumptions documented
- [x] Audit event helper available for on-chain governance records
