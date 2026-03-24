use soroban_sdk::{token, Address, Env};

use crate::DataKey;

/// @title Refund Single Token Transfer Helper
/// @notice Centralizes transfer direction for contributor refunds.
/// @dev Keeps contract-side call sites explicit and typo-resistant for scripts.
pub fn refund_single_transfer(
    token_client: &token::Client,
    contract_address: &Address,
    contributor: &Address,
    amount: i128,
) {
    token_client.transfer(contract_address, contributor, &amount);
}

/// Refunds a single contributor by transferring their stored contribution
/// amount back from the contract to their address.
///
/// @notice This is the atomic unit of the bulk `refund()` loop.
/// @param env The Soroban execution environment.
/// @param token_address The token contract address.
/// @param contributor The contributor to refund.
/// @return The amount refunded (0 if nothing was owed).
pub fn refund_single(env: &Env, token_address: &Address, contributor: &Address) -> i128 {
    let contribution_key = DataKey::Contribution(contributor.clone());
    let amount: i128 = env
        .storage()
        .persistent()
        .get(&contribution_key)
        .unwrap_or(0);

    if amount == 0 {
        return 0;
    }

    let token_client = token::Client::new(env, token_address);
    token_client.transfer(&env.current_contract_address(), contributor, &amount);

    env.storage().persistent().set(&contribution_key, &0i128);
    env.storage()
        .persistent()
        .extend_ttl(&contribution_key, 100, 100);

    env.events()
        .publish(("campaign", "refund_single"), (contributor.clone(), amount));

    amount
}

/// Returns the stored contribution amount for a contributor.
pub fn get_contribution(env: &Env, contributor: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Contribution(contributor.clone()))
        .unwrap_or(0)
}
