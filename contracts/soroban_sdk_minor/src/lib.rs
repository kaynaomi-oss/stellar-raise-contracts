#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

/// Storage key for the admin address.
#[contracttype]
pub enum DataKey {
    Admin,
}

/// # SorobanSdkMinor
///
/// @title   SorobanSdkMinor — Soroban SDK v22 patterns demonstration
/// @notice  Showcases updated Address, Auth, and storage patterns introduced
///          in the Soroban SDK v22 minor version bump.
/// @dev     Uses `contracttype` enum keys (not raw strings) for storage,
///          `require_auth()` for authorization, and `env.register` in tests.
///
/// ## Security Assumptions
/// 1. Only the admin can call `init` — enforced via `require_auth()`.
/// 2. Only the caller themselves can satisfy `check_auth` — enforced via `require_auth()`.
/// 3. Storage keys are typed enums, preventing key-collision bugs.
#[contract]
pub struct SorobanSdkMinor;

#[contractimpl]
impl SorobanSdkMinor {
    /// @notice Initializes the contract by storing the admin address.
    /// @dev    Requires the admin to authorize this call (Soroban v22 auth pattern).
    /// @param  admin The administrator address to store.
    pub fn init(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// @notice Verifies that `user` has authorized the current call.
    /// @param  user The address whose authorization is being checked.
    /// @return `true` if authorization succeeds (panics otherwise).
    pub fn check_auth(_env: Env, user: Address) -> bool {
        user.require_auth();
        true
    }

    /// @notice Returns the stored admin address.
    /// @dev    Panics if `init` has not been called yet.
    /// @return The admin `Address`.
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }
}

mod test;
