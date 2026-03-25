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