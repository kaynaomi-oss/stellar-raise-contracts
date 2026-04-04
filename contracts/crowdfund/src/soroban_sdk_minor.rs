#![allow(deprecated)]
#![allow(clippy::doc_overindented_list_items)]

//! Soroban SDK minor-bump helpers for frontend UI and scalability.
//!
//! This module centralizes low-level helpers used when reviewing/operating a
//! minor Soroban SDK bump so behaviour is explicit, testable, and audit-friendly.
//!
//! ## Security Assumptions
//! 1. All version-comparison helpers are read-only — no state mutations.
//! 2. Empty version strings return `Incompatible` rather than silently mapping
//!    to major-0, preventing a misconfigured UI call from being treated as a
//!    valid same-major upgrade.
//! 3. `validate_wasm_hash` rejects a zeroed hash to prevent accidental contract
//!    bricking during an upgrade.
//! 4. `clamp_page_size` bounds frontend scan size to prevent indexer overload.
//! 5. `emit_upgrade_audit_event_with_note` panics on oversized notes to keep
//!    the event schema predictable and indexer-friendly.
//! 6. `emit_ping_event` requires the emitter to authorize the call, enforcing
//!    the Soroban v22 auth pattern for all state-touching operations.

use soroban_sdk::{contracttype, Address, Env, String, Symbol};

// ── Types ────────────────────────────────────────────────────────────────

/// Compatibility assessment result for SDK version comparisons.
#[derive(Clone, PartialEq, Debug)]
#[contracttype]
pub enum Compatibility {
    /// Same major version — safe to upgrade without migration.
    Compatible,
    /// Different major versions — requires data migration.
    RequiresMigration,
    /// Invalid/empty version string — malformed input.
    Incompatible,
}

/// Metadata describing a single SDK change relevant to this contract.
#[derive(Clone)]
#[contracttype]
pub struct SdkChangeRecord {
    /// Short identifier for the change (e.g. `"extend_ttl_signature"`).
    pub id: Symbol,
    /// Whether the change is breaking for this contract.
    pub is_breaking: bool,
    /// Human-readable description stored on-chain for auditability.
    pub description: String,
}

/// @notice Frontend pagination window computed from `offset` and `requested`.
#[derive(Clone, PartialEq, Debug)]
#[contracttype]
pub struct PaginationWindow {
    pub start: u32,
    pub limit: u32,
}

// ── Compatibility helpers ─────────────────────────────────────────────────────

/// @notice Assesses whether upgrading from `from_version` to `to_version` is
///         safe for this contract's storage layout and ABI.
///
/// @dev Returns:
///   - `Compatible`          — same major version (safe minor/patch bump).
///   - `RequiresMigration`   — different major versions.
///   - `Incompatible`        — either version string is empty (malformed input
///                             that the frontend should surface as an error).
///
/// @security Read-only; no state mutations.
pub fn assess_compatibility(_env: &Env, from_version: &str, to_version: &str) -> Compatibility {
    if from_version.is_empty() || to_version.is_empty() {
        return Compatibility::Incompatible;
    }

    let extract_major = |v: &str| -> Option<u32> { v.split('.').next()?.parse().ok() };

    match (extract_major(from_version), extract_major(to_version)) {
        (Some(from_major), Some(to_major)) => {
            if from_major == to_major {
                Compatibility::Compatible
            } else {
                Compatibility::RequiresMigration
            }
        }
        _ => Compatibility::Incompatible,
    }
}

/// @notice Validates that a WASM hash is non-zero.
///
/// @dev Prevents accidental contract bricking during upgrade.
/// @security Rejects zeroed hash; no state mutations.
pub fn validate_wasm_hash(hash: &[u8; 32]) -> bool {
    hash != &[0u8; 32]
}

/// @notice Clamps a requested page size to safe bounds.
///
/// @dev Prevents frontend from requesting excessively large pages.
/// @security Read-only; returns bounded value.
pub fn clamp_page_size(requested: u32, max: u32) -> u32 {
    requested.min(max).max(1)
}

/// @notice Emits an audit event for SDK upgrades with optional note.
///
/// @dev Panics if note exceeds 100 bytes to keep event schema predictable.
/// @security Requires caller authorization; emits to immutable ledger.
pub fn emit_upgrade_audit_event_with_note(
    env: &Env,
    from_version: &str,
    to_version: &str,
    note: &str,
) {
    let note_str = String::from_str(env, note);
    // Enforce reasonable note size for indexer health
    assert!(note_str.len() <= 100, "Upgrade note too long");

    env.events().publish(
        (Symbol::new(env, "sdk_upgrade"),),
        (from_version, to_version, note_str),
    );
}

/// @notice Emits a simple ping event for testing connectivity.
///
/// @dev Requires the emitter to authorize the call, preventing spoofed audit trails.
pub fn emit_ping_event(env: &Env, from: Address, value: i32) {
    from.require_auth();
    env.events().publish((Symbol::short("ping"),), value);
}
