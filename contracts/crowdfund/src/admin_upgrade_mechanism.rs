use crate::DataKey;
use soroban_sdk::{Address, BytesN, Env};

// ── Constants ─────────────────────────────────────────────────────────────────

/// A zeroed 32-byte hash is never a valid WASM hash.
/// Rejecting it before any storage read or deployer call saves gas.
const ZERO_HASH: [u8; 32] = [0u8; 32];

// ── Pure helpers (no Env required) ───────────────────────────────────────────

/// @title validate_wasm_hash
/// @notice Returns `true` when `wasm_hash` is non-zero.
/// @dev Pure function — no storage reads, no auth, minimal gas cost.
///      Called before `validate_admin_upgrade` so an invalid hash is rejected
///      at the cheapest possible point in the call stack.
/// @security Prevents upgrade calls with a zeroed hash, which would brick
///           the contract by replacing its executable code with nothing.
pub fn validate_wasm_hash(wasm_hash: &BytesN<32>) -> bool {
    wasm_hash.to_array() != ZERO_HASH
}

// ── Storage helpers ───────────────────────────────────────────────────────────

/// @title is_admin_initialized
/// @notice Returns `true` when an admin address has been stored.
/// @dev Uses `has()` — a single existence check — rather than `get()` + unwrap,
///      which avoids deserializing the stored value when only presence matters.
///      Callers that only need to gate on initialization should prefer this over
///      `validate_admin_upgrade` to avoid the unnecessary `require_auth()` cost.
/// @security Read-only; no state mutations.
pub fn is_admin_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

/// @title validate_admin_upgrade
/// @notice Loads the stored admin address and enforces authorization.
/// @dev Panics with "Admin not initialized" when no admin is stored, and
///      delegates auth enforcement to Soroban's `require_auth()`.
///      Callers MUST call `validate_wasm_hash` before this function to
///      short-circuit on a zero hash before paying the storage-read cost.
/// @security `require_auth()` ensures the transaction is signed by the admin
///           address stored during initialization.
pub fn validate_admin_upgrade(env: &Env) -> Address {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("Admin not initialized");
    admin.require_auth();
    admin
}

/// @title perform_upgrade
/// @notice Executes the WASM swap via the Soroban deployer.
/// @dev Must only be called after both `validate_wasm_hash` and
///      `validate_admin_upgrade` have succeeded.  Separating validation from
///      execution keeps each function single-responsibility and testable in
///      isolation.
pub fn perform_upgrade(env: &Env, new_wasm_hash: BytesN<32>) {
    env.deployer().update_current_contract_wasm(new_wasm_hash);
//! # Admin Upgrade Mechanism
//!
//! This module provides a secure and auditable mechanism for upgrading smart contract
//! WASM code. It ensures that only authorized administrators can perform upgrades,
//! while maintaining full transparency and audit capabilities through event emissions.
//!
//! ## Security Features
//!
//! - **Authentication**: All upgrade operations require admin authentication via `require_auth()`
//! - **Atomic Operations**: Upgrades are atomic - they either succeed completely or fail
//! - **Event Audit Trail**: All upgrade operations emit events for off-chain monitoring
//! - **Admin Verification**: Contract prevents upgrades before initialization
//! - **Separation of Concerns**: Admin role is distinct from campaign creator role
//!
//! @author Stellar Crowdfund Protocol
//! @version 1.0.0

#![allow(unused)]

/// Storage keys for admin upgrade mechanism.
#[derive(Clone)]
pub enum DataKey {
    /// The current admin address authorized to perform upgrades.
    Admin,
    /// The current WASM hash of the deployed contract.
    CurrentWasmHash,
    /// Upgrade history for audit purposes.
    UpgradeHistory,
}

/// Errors that can occur during admin upgrade operations.
#[derive(Debug, Clone, PartialEq, Eq)]
#[repr(u32)]
pub enum UpgradeError {
    /// The contract has not been initialized yet (no admin set).
    NotInitialized = 1,
    /// The caller is not the authorized admin.
    NotAuthorized = 2,
    /// The provided WASM hash is invalid (e.g., zero bytes).
    InvalidWasmHash = 3,
    /// The new WASM hash is the same as the current one.
    SameWasmHash = 4,
    /// The new admin address is the same as the current admin.
    SameAdmin = 5,
    /// The new admin address is invalid (e.g., zero address).
    InvalidAdminAddress = 6,
}

/// Helper struct for admin upgrade operations.
pub struct AdminUpgradeHelper;

impl AdminUpgradeHelper {
    /// Validate a WASM hash.
    ///
    /// A valid WASM hash must not be all zeros.
    ///
    /// # Arguments
    /// * `wasm_hash` - The WASM hash to validate
    ///
    /// # Returns
    /// * `Result<(), UpgradeError>` - Ok if valid, error otherwise
    pub fn validate_wasm_hash(wasm_hash: &soroban_sdk::BytesN<32>) -> Result<(), UpgradeError> {
        // Check for zero hash (all zeros)
        let hash_array = wasm_hash.to_array();
        let is_zero = hash_array.iter().all(|&b| b == 0);
        if is_zero {
            return Err(UpgradeError::InvalidWasmHash);
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use soroban_sdk::BytesN;

    use super::AdminUpgradeHelper;

    /// Test that valid WASM hash passes validation.
    #[test]
    fn test_validate_wasm_hash_valid() {
        let env = soroban_sdk::Env::default();
        let valid_hash = BytesN::from_array(&env, &[0xAB; 32]);
        assert!(AdminUpgradeHelper::validate_wasm_hash(&valid_hash).is_ok());
    }

    /// Test that zero WASM hash is rejected.
    #[test]
    fn test_validate_wasm_hash_zero_rejected() {
        let env = soroban_sdk::Env::default();
        let zero_hash = BytesN::from_array(&env, &[0u8; 32]);
        assert_eq!(
            AdminUpgradeHelper::validate_wasm_hash(&zero_hash),
            Err(super::UpgradeError::InvalidWasmHash)
        );
    }

    /// Test that max value WASM hash is valid.
    #[test]
    fn test_max_value_wasm_hash_valid() {
        let env = soroban_sdk::Env::default();
        let max_value = BytesN::from_array(&env, &[0xFF; 32]);
        assert!(AdminUpgradeHelper::validate_wasm_hash(&max_value).is_ok());
    }
}
use soroban_sdk::{Address, Env, BytesN};
use crate::DataKey;

/// Validates that the caller is the authorized admin for contract upgrades.
/// 
/// ### Security Note
/// This function uses `require_auth()` which ensures the transaction is 
/// signed by the admin address stored during initialization.
pub fn validate_admin_upgrade(env: &Env) -> Address {
    let admin: Address = env.storage().instance().get(&DataKey::Admin)
        .expect("Admin not initialized");
    
    admin.require_auth();
    admin
}

/// Executes the WASM update.
pub fn perform_upgrade(env: &Env, new_wasm_hash: BytesN<32>) {
    env.deployer().update_current_contract_wasm(new_wasm_hash);
}
