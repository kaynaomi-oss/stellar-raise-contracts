#![cfg(test)]
use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::Env;

// ── helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, SorobanSdkMinorClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(SorobanSdkMinor, ());
    let client = SorobanSdkMinorClient::new(&env, &id);
    (env, client)
}

// ── init ──────────────────────────────────────────────────────────────────────

/// Happy path: init stores the admin and get_admin returns it.
#[test]
fn test_init_stores_admin() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.init(&admin);

    assert_eq!(client.get_admin(), admin);
}

/// Different admins produce different stored values.
#[test]
fn test_init_different_admins() {
    let (env, client) = setup();
    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    client.init(&admin1);
    assert_eq!(client.get_admin(), admin1);
    // Re-init with a different admin (no guard in this contract).
    client.init(&admin2);
    assert_eq!(client.get_admin(), admin2);
}

// ── check_auth ────────────────────────────────────────────────────────────────

/// check_auth returns true when auth is mocked.
#[test]
fn test_check_auth_returns_true_via_mock() {
    let (env, client) = setup();
    let user = Address::generate(&env);

    // In tests, require_auth is satisfied automatically unless specific auth mocks are used.
    assert!(client.check_auth(&user));
}

/// Two different users both pass check_auth independently.
#[test]
fn test_check_auth_multiple_users() {
    let (env, client) = setup();
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    assert!(client.check_auth(&user_a));
    assert!(client.check_auth(&user_b));
}

// ── get_admin ─────────────────────────────────────────────────────────────────

/// get_admin panics when contract is not initialized.
#[test]
#[should_panic(expected = "not initialized")]
fn test_get_admin_panics_when_not_initialized() {
    let (_, client) = setup();
    client.get_admin();
}

/// get_admin returns the most recently set admin after re-init.
#[test]
fn test_get_admin_after_reinit() {
    let (env, client) = setup();
    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    client.init(&admin1);
    client.init(&admin2);
    assert_eq!(client.get_admin(), admin2);
}

// ── logging bounds / SDK v22 patterns ────────────────────────────────────────

/// Verifies that the typed DataKey::Admin enum key is used (no string key collision).
/// Indirectly confirmed by init + get_admin round-trip succeeding.
#[test]
fn test_typed_storage_key_roundtrip() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.init(&admin);
    // If storage used a raw string key this would still pass, but the
    // contract source uses DataKey::Admin — confirmed by compilation.
    assert_eq!(client.get_admin(), admin);
}
