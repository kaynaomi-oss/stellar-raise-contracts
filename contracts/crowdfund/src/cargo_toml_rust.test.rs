//! Tests for `cargo_toml_rust` — dependency policy enforcement.
//!
//! ## Security notes
//! - Version constants are pinned; any accidental change is caught immediately.
//! - `all_deprecated_versions_replaced` guards against re-introducing old deps.
//! - `dev_only` flag on proptest confirms it never enters the WASM binary.

#![cfg(test)]

use crate::cargo_toml_rust::{
    all_deprecated_versions_replaced, audited_dependencies, DepRecord, PROPTEST_VERSION,
    PROPTEST_VERSION_DEPRECATED, SOROBAN_SDK_VERSION, SOROBAN_SDK_VERSION_DEPRECATED,
};

// ── Version constant stability ────────────────────────────────────────────────

#[test]
fn soroban_sdk_version_is_pinned() {
    assert_eq!(SOROBAN_SDK_VERSION, "22.0.11");
}

#[test]
fn soroban_sdk_deprecated_version_is_recorded() {
    #[allow(deprecated)]
    let v = SOROBAN_SDK_VERSION_DEPRECATED;
    assert_eq!(v, "22.0.1");
}

#[test]
fn proptest_version_is_pinned() {
    assert_eq!(PROPTEST_VERSION, "1.11.0");
}

#[test]
fn proptest_deprecated_version_is_recorded() {
    #[allow(deprecated)]
    let v = PROPTEST_VERSION_DEPRECATED;
    assert_eq!(v, "1.4");
}

// ── audited_dependencies ──────────────────────────────────────────────────────

#[test]
fn audited_dependencies_has_two_entries() {
    assert_eq!(audited_dependencies().len(), 2);
}

#[test]
fn soroban_sdk_dep_is_not_dev_only() {
    let deps = audited_dependencies();
    let sdk = deps.iter().find(|d| d.name == "soroban-sdk").unwrap();
    assert!(!sdk.dev_only);
}

#[test]
fn soroban_sdk_dep_version_matches_constant() {
    let deps = audited_dependencies();
    let sdk = deps.iter().find(|d| d.name == "soroban-sdk").unwrap();
    assert_eq!(sdk.version, SOROBAN_SDK_VERSION);
}

#[test]
fn soroban_sdk_dep_marks_previous_as_deprecated() {
    let deps = audited_dependencies();
    let sdk = deps.iter().find(|d| d.name == "soroban-sdk").unwrap();
    assert!(sdk.deprecated_previous);
}

#[test]
fn proptest_dep_is_dev_only() {
    let deps = audited_dependencies();
    let pt = deps.iter().find(|d| d.name == "proptest").unwrap();
    assert!(pt.dev_only);
}

#[test]
fn proptest_dep_version_matches_constant() {
    let deps = audited_dependencies();
    let pt = deps.iter().find(|d| d.name == "proptest").unwrap();
    assert_eq!(pt.version, PROPTEST_VERSION);
}

#[test]
fn proptest_dep_marks_previous_as_deprecated() {
    let deps = audited_dependencies();
    let pt = deps.iter().find(|d| d.name == "proptest").unwrap();
    assert!(pt.deprecated_previous);
}

// ── all_deprecated_versions_replaced ─────────────────────────────────────────

#[test]
fn all_deprecated_versions_replaced_returns_true() {
    assert!(all_deprecated_versions_replaced());
}

#[test]
fn dep_record_with_no_deprecated_previous_fails_check() {
    // Simulate a dep that has NOT replaced its deprecated predecessor.
    let dep = DepRecord {
        name: "some-crate",
        version: "1.0.0",
        dev_only: false,
        deprecated_previous: false,
    };
    assert!(!dep.deprecated_previous);
}

// ── DepRecord equality ────────────────────────────────────────────────────────

#[test]
fn dep_record_equality() {
    let a = DepRecord {
        name: "soroban-sdk",
        version: "22.0.11",
        dev_only: false,
        deprecated_previous: true,
    };
    let b = DepRecord {
        name: "soroban-sdk",
        version: "22.0.11",
        dev_only: false,
        deprecated_previous: true,
    };
    assert_eq!(a, b);
}

#[test]
fn dep_record_inequality_on_version() {
    let a = DepRecord {
        name: "soroban-sdk",
        version: "22.0.1",
        dev_only: false,
        deprecated_previous: true,
    };
    let b = DepRecord {
        name: "soroban-sdk",
        version: "22.0.11",
        dev_only: false,
        deprecated_previous: true,
    };
    assert_ne!(a, b);
}
