#![cfg(test)]

use crate::{CrowdfundContract, CrowdfundContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

extern crate std;

// Mock NFT contract for testing
#[allow(dead_code)]
pub struct MockNftContract;

#[allow(dead_code)]
impl MockNftContract {
    #[allow(dead_code)]
    pub fn mint(_env: Env, _to: Address, _token_id: u64) {
        // Mock implementation
    }
}

#[allow(dead_code)]
pub struct MockNftContractClient<'a> {
    pub env: &'a Env,
    pub contract_id: &'a Address,
}

#[allow(dead_code)]
impl<'a> MockNftContractClient<'a> {
    #[allow(dead_code)]
    pub fn new(env: &'a Env, contract_id: &'a Address) -> Self {
        Self { env, contract_id }
    }

    #[allow(dead_code)]
    pub fn minted(&self) -> std::vec::Vec<MintedNft> {
        // Mock implementation
        std::vec::Vec::new()
    }
}

#[allow(dead_code)]
pub struct MintedNft {
    pub to: Address,
    pub token_id: u64,
}

fn create_token_contract<'a>(
    env: &Env,
    admin: &Address,
) -> (Address, token::StellarAssetClient<'a>) {
    let token_contract_id = env.register_stellar_asset_contract_v2(admin.clone());
    let token_address = token_contract_id.address();
    let token_client = token::StellarAssetClient::new(env, &token_address);
    (token_address, token_client)
}

fn setup_env() -> (
    Env,
    CrowdfundContractClient<'static>,
    Address,
    Address,
    Address,
    token::StellarAssetClient<'static>,
) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(CrowdfundContract, ());
    let client = CrowdfundContractClient::new(&env, &contract_id);

    let platform_admin = Address::generate(&env);
    let creator = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_address, token_client) = create_token_contract(&env, &token_admin);

    (
        env,
        client,
        platform_admin,
        creator,
        token_address,
        token_client,
    )
}

#[allow(dead_code)]
fn default_init(
    client: &CrowdfundContractClient,
    creator: &Address,
    token_address: &Address,
    deadline: u64,
) -> Address {
    let admin = creator.clone();
    client.initialize(
        &admin,
        creator,
        token_address,
        &1_000_000,
        &deadline,
        &1_000,
        &None,
        &None,
        &None,
    );
    admin
}

#[test]
fn test_initialize() {
    let (env, client, platform_admin, creator, token_address, _token_client) = setup_env();
    let deadline = env.ledger().timestamp() + 3600;

    client.initialize(
        &platform_admin,
        &creator,
        &token_address,
        &1_000_000,
        &deadline,
        &1_000,
        &None,
        &None,
        &None,
    );

    // Verify initialization was successful
    assert_eq!(client.goal(), 1_000_000);
    assert_eq!(client.deadline(), deadline);
    assert_eq!(client.min_contribution(), 1_000);
    assert_eq!(client.total_raised(), 0);
}

#[test]
fn test_contribute() {
    let (env, client, platform_admin, creator, token_address, token_admin_client) = setup_env();
    let deadline = env.ledger().timestamp() + 3600;

    client.initialize(
        &platform_admin,
        &creator,
        &token_address,
        &1_000_000,
        &deadline,
        &1_000,
        &None,
        &None,
        &None,
    );

    let contributor = Address::generate(&env);
    let amount = 5_000;

    // Mint tokens to contributor so they can contribute
    token_admin_client.mint(&contributor, &amount);

    client.contribute(&contributor, &amount);

    // Verify contribution was recorded
    assert_eq!(client.total_raised(), amount);
    assert_eq!(client.contributors().len(), 1);
}

#[test]
fn test_withdraw() {
    let (env, client, platform_admin, creator, token_address, token_admin_client) = setup_env();
    let deadline = env.ledger().timestamp() + 3600;

    client.initialize(
        &platform_admin,
        &creator,
        &token_address,
        &1_000_000,
        &deadline,
        &1_000,
        &None,
        &None,
        &None,
    );

    let contributor = Address::generate(&env);
    let goal_amount = 1_000_000;

    // Mint tokens to contributor so they can contribute the full goal
    token_admin_client.mint(&contributor, &goal_amount);

    client.contribute(&contributor, &goal_amount);

    // Fast forward past deadline
    env.ledger().set_timestamp(deadline + 1);

    client.withdraw();

    // Verify withdrawal was successful - total_raised should be 0 after withdrawal
    assert_eq!(client.total_raised(), 0);
}

#[test]
fn test_initialize_twice_returns_error() {
    let (env, client, platform_admin, creator, token_address, _token_client) = setup_env();
    let deadline = env.ledger().timestamp() + 3600;

    client.initialize(
        &platform_admin,
        &creator,
        &token_address,
        &1_000_000,
        &deadline,
        &1_000,
        &None,
        &None,
        &None,
    );

    let result = client.try_initialize(
        &platform_admin,
        &creator,
        &token_address,
        &1_000_000,
        &deadline,
        &1_000,
        &None,
        &None,
        &None,
    );

    assert!(result.is_err());
}

#[test]
fn test_empty_registry() {
    let (_env, client, _platform_admin, _creator, _token_address, _token_client) = setup_env();

    // Verify empty state - these should be default values before initialization
    assert_eq!(client.total_raised(), 0);
    assert_eq!(client.contributors().len(), 0);
}
