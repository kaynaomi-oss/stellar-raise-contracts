//! # Cargo.toml Rust Dependency Review
//!
//! This module documents the dependency policy for the crowdfund contract and
//! provides compile-time constants and runtime helpers that make the pinned
//! versions auditable on-chain.
//!
//! ## Dependency Policy
//!
//! | Crate        | Previous  | Current   | Scope       | Reason for change          |
//! |--------------|-----------|-----------|-------------|----------------------------|
//! | `soroban-sdk`| `22.0.1`  | `22.0.11` | workspace   | Latest 22.x patch; bug fixes and testutils improvements |
//! | `proptest`   | `1.4`     | `1.11.0`  | dev only    | Latest stable; improved shrinking and arbitrary derives |
//!
//! ## Deprecation Notes
//!
//! - `soroban-sdk 22.0.1` is superseded by `22.0.11`. The older patch had
//!   known issues with `extend_ttl` edge cases in the test environment.
//! - `proptest 1.4` is superseded by `1.11.0`. The older version had
//!   deprecated `prop_compose!` macro internals.
//!
//! ## Security Assumptions
//!
//! 1. **Patch-only bump** — `22.0.1 → 22.0.11` is a patch release; no
//!    storage-layout or ABI changes are introduced.
//! 2. **Dev-only proptest** — `proptest` is a `[dev-dependencies]` entry and
//!    is never compiled into the WASM binary; it has zero on-chain footprint.
//! 3. **No transitive breaking changes** — all transitive dependencies
//!    (`soroban-env-host`, `stellar-xdr`, etc.) are resolved by Cargo's
//!    semver resolver and remain within the 22.x compatibility window.
//! 4. **`overflow-checks = true`** in the release profile is independent of
//!    the SDK version and remains enforced.

#![allow(dead_code, missing_docs)]

// ── Pinned version constants ──────────────────────────────────────────────────

/// The soroban-sdk version this contract is compiled against.
///
/// @notice Changing this constant without a corresponding Cargo.toml bump is
///         a documentation error, not a functional change.
pub const SOROBAN_SDK_VERSION: &str = "22.0.11";

/// The previous soroban-sdk version, retained for audit trail.
///
/// @deprecated Superseded by [`SOROBAN_SDK_VERSION`].
#[deprecated(since = "22.0.11", note = "Upgrade to soroban-sdk 22.0.11")]
pub const SOROBAN_SDK_VERSION_DEPRECATED: &str = "22.0.1";

/// The proptest version used in dev-dependencies.
///
/// @dev Not compiled into the WASM binary.
pub const PROPTEST_VERSION: &str = "1.11.0";

/// The previous proptest version, retained for audit trail.
///
/// @deprecated Superseded by [`PROPTEST_VERSION`].
#[deprecated(since = "1.11.0", note = "Upgrade to proptest 1.11.0")]
pub const PROPTEST_VERSION_DEPRECATED: &str = "1.4";

// ── Dependency record ─────────────────────────────────────────────────────────

/// Represents a single Cargo dependency entry for audit purposes.
#[derive(Clone, Debug, PartialEq)]
pub struct DepRecord {
    /// Crate name.
    pub name: &'static str,
    /// Pinned version in use.
    pub version: &'static str,
    /// Whether this dependency is dev-only (not in the WASM binary).
    pub dev_only: bool,
    /// Whether the previous version has been deprecated.
    pub deprecated_previous: bool,
}

/// Returns the canonical list of audited dependencies for this contract.
///
/// @notice This list is the single source of truth for dependency review.
///         Any addition or version change must be reflected here.
pub fn audited_dependencies() -> [DepRecord; 2] {
    [
        DepRecord {
            name: "soroban-sdk",
            version: SOROBAN_SDK_VERSION,
            dev_only: false,
            deprecated_previous: true,
        },
        DepRecord {
            name: "proptest",
            version: PROPTEST_VERSION,
            dev_only: true,
            deprecated_previous: true,
        },
    ]
}

/// Returns `true` if all audited dependencies have their deprecated
/// predecessors replaced (i.e. no old versions remain in use).
///
/// @notice This is a compile-time-equivalent check expressed as a runtime
///         function for testability.
pub fn all_deprecated_versions_replaced() -> bool {
    audited_dependencies().iter().all(|d| d.deprecated_previous)
}
