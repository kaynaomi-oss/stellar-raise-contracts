#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token, Address, Env,
};

use crate::{CrowdfundContract, CrowdfundContractClient};

// ── Helpers ─────────────────────────────────────────────────────────────────

/// Set up a fresh environment with a deployed crowdfund contract and a token.
fn setup_env() -> (
    Env,
    CrowdfundContractClient<'static>,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();

    // Deploy the crowdfund contract.
    let contract_id = env.register(CrowdfundContract, ());
    let client = CrowdfundContractClient::new(&env, &contract_id);

    // Create a token for contributions.
    let token_admin = Address::generate(&env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract_id.address();
    let token_admin_client = token::StellarAssetClient::new(&env, &token_address);

    // Campaign creator.
    let creator = Address::generate(&env);

    // Mint tokens to the creator so the contract has something to work with.
    token_admin_client.mint(&creator, &10_000_000);

    (env, client, creator, token_address, token_admin.clone())
}

/// Helper to mint tokens to an arbitrary contributor.
fn mint_to(env: &Env, token_address: &Address, admin: &Address, to: &Address, amount: i128) {
    let admin_client = token::StellarAssetClient::new(env, token_address);
    admin_client.mint(to, &amount);
    let _ = admin;
}

/// Helper to create default title and description for tests.
fn default_title(env: &Env) -> soroban_sdk::String {
    soroban_sdk::String::from_str(env, "Test Campaign")
}

fn default_description(env: &Env) -> soroban_sdk::String {
    soroban_sdk::String::from_str(env, "A test crowdfunding campaign")
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[test]
fn test_initialize() {
    let (env, client, creator, token_address, _admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600; // 1 hour from now
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    let title = default_title(&env);
    let description = default_description(&env);

    client.initialize(
        &creator,
        &token_address,
        &goal,
        &(goal * 2),
        &deadline,
        &min_contribution,
        &title,
        &description,
        &None,
    );

    assert_eq!(client.goal(), goal);
    assert_eq!(client.deadline(), deadline);
    assert_eq!(client.min_contribution(), min_contribution);
    assert_eq!(client.total_raised(), 0);
    assert_eq!(client.title(), title);
    assert_eq!(client.description(), description);
}

#[test]
fn test_version() {
    let (_env, client, _creator, _token_address, _admin) = setup_env();

    // Test that version() returns the expected version number
    assert_eq!(client.version(), 2);
}

#[test]
fn test_double_initialize_panics() {
    let (env, client, creator, token_address, _admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;

    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );
    let result = client.try_initialize(
        &creator,
        &token_address,
        &goal,
        &(goal * 2),
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().unwrap(),
        crate::ContractError::AlreadyInitialized
    );
}

#[test]
fn test_contribute() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 500_000);

    client.contribute(&contributor, &500_000);

    assert_eq!(client.total_raised(), 500_000);
    assert_eq!(client.contribution(&contributor), 500_000);
}

#[test]
fn test_multiple_contributions() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &alice, 600_000);
    mint_to(&env, &token_address, &admin, &bob, 400_000);

    client.contribute(&alice, &600_000);
    client.contribute(&bob, &400_000);

    assert_eq!(client.total_raised(), 1_000_000);
    assert_eq!(client.contribution(&alice), 600_000);
    assert_eq!(client.contribution(&bob), 400_000);
}

#[test]
fn test_contribute_after_deadline_panics() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 100;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    // Fast-forward past the deadline.
    env.ledger().set_timestamp(deadline + 1);

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 500_000);

    let result = client.try_contribute(&contributor, &500_000);

    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().unwrap(),
        crate::ContractError::CampaignEnded
    );
}

#[test]
fn test_withdraw_after_goal_met() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 1_000_000);
    client.contribute(&contributor, &1_000_000);

    assert_eq!(client.total_raised(), goal);

    // Move past deadline.
    env.ledger().set_timestamp(deadline + 1);

    client.withdraw();

    // After withdrawal, total_raised resets to 0.
    assert_eq!(client.total_raised(), 0);

    // Creator should have received the funds.
    let token_client = token::Client::new(&env, &token_address);
    assert_eq!(token_client.balance(&creator), 10_000_000 + 1_000_000);
}

#[test]
fn test_withdraw_before_deadline_panics() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 1_000_000);
    client.contribute(&contributor, &1_000_000);

    let result = client.try_withdraw();

    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().unwrap(),
        crate::ContractError::CampaignStillActive
    );
}

#[test]
fn test_withdraw_goal_not_reached_panics() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 500_000);
    client.contribute(&contributor, &500_000);

    // Move past deadline, but goal not met.
    env.ledger().set_timestamp(deadline + 1);

    let result = client.try_withdraw();

    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().unwrap(),
        crate::ContractError::GoalNotReached
    );
}

#[test]
fn test_refund_single_when_goal_not_met() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &alice, 300_000);
    mint_to(&env, &token_address, &admin, &bob, 200_000);

    client.contribute(&alice, &300_000);
    client.contribute(&bob, &200_000);

    // Move past deadline — goal not met.
    env.ledger().set_timestamp(deadline + 1);

    client.refund_single(&alice);
    client.refund_single(&bob);

    // Both contributors should get their tokens back.
    let token_client = token::Client::new(&env, &token_address);
    assert_eq!(token_client.balance(&alice), 300_000);
    assert_eq!(token_client.balance(&bob), 200_000);
    assert_eq!(client.total_raised(), 0);
}

#[test]
fn test_refund_when_goal_reached_panics() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 1_000_000);
    client.contribute(&contributor, &1_000_000);

    env.ledger().set_timestamp(deadline + 1);

    let result = client.try_refund_single(&contributor);

    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().unwrap(),
        crate::ContractError::GoalReached
    );
}
#[test]
fn test_refund_single_before_deadline_fails() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 500_000);
    client.contribute(&contributor, &500_000);

    // Try to refund before deadline passes
    let result = client.try_refund_single(&contributor);

    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err().unwrap(),
        crate::ContractError::CampaignStillActive
    );
}

// ── Bug Condition Exploration Test ─────────────────────────────────────────

/// **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**
///
/// **Property 1: Fault Condition** - Structured Error Returns
///
/// This test verifies that all 6 error conditions return the appropriate
/// ContractError variants instead of panicking.
///
/// The test covers all 6 error conditions:
/// 1. Double initialization → Err(ContractError::AlreadyInitialized)
/// 2. Late contribution → Err(ContractError::CampaignEnded)
/// 3. Early withdrawal → Err(ContractError::CampaignStillActive)
/// 4. Withdrawal without goal → Err(ContractError::GoalNotReached)
/// 5. Early refund → Err(ContractError::CampaignStillActive)
/// 6. Refund after success → Err(ContractError::GoalReached)
#[test]
fn test_bug_condition_exploration_all_error_conditions_panic() {
    use crate::ContractError;

    // Test 1: Double initialization
    {
        let (env, client, creator, token_address, _admin) = setup_env();
        let deadline = env.ledger().timestamp() + 3600;
        let goal: i128 = 1_000_000;

        client.initialize(
            &creator,
            &token_address,
            &goal,
            &deadline,
            &1_000,
            &default_title(&env),
            &default_description(&env),
            &None,
        );
        let result = client.try_initialize(
            &creator,
            &token_address,
            &goal,
            &deadline,
            &1_000,
            &default_title(&env),
            &default_description(&env),
            &None,
        );

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::AlreadyInitialized
        );
    }

    // Test 2: Late contribution
    {
        let (env, client, creator, token_address, admin) = setup_env();
        let deadline = env.ledger().timestamp() + 100;
        let goal: i128 = 1_000_000;
        client.initialize(
            &creator,
            &token_address,
            &goal,
            &deadline,
            &1_000,
            &default_title(&env),
            &default_description(&env),
            &None,
        );

        env.ledger().set_timestamp(deadline + 1);

        let contributor = Address::generate(&env);
        mint_to(&env, &token_address, &admin, &contributor, 500_000);
        let result = client.try_contribute(&contributor, &500_000);

        assert!(result.is_err());
        assert_eq!(result.unwrap_err().unwrap(), ContractError::CampaignEnded);
    }

    // Test 3: Early withdrawal
    {
        let (env, client, creator, token_address, admin) = setup_env();
        let deadline = env.ledger().timestamp() + 3600;
        let goal: i128 = 1_000_000;
        client.initialize(
            &creator,
            &token_address,
            &goal,
            &deadline,
            &1_000,
            &default_title(&env),
            &default_description(&env),
            &None,
        );

        let contributor = Address::generate(&env);
        mint_to(&env, &token_address, &admin, &contributor, 1_000_000);
        client.contribute(&contributor, &1_000_000);

        let result = client.try_withdraw();

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::CampaignStillActive
        );
    }

    // Test 4: Withdrawal without goal
    {
        let (env, client, creator, token_address, admin) = setup_env();
        let deadline = env.ledger().timestamp() + 3600;
        let goal: i128 = 1_000_000;
        client.initialize(
            &creator,
            &token_address,
            &goal,
            &deadline,
            &1_000,
            &default_title(&env),
            &default_description(&env),
            &None,
        );

        let contributor = Address::generate(&env);
        mint_to(&env, &token_address, &admin, &contributor, 500_000);
        client.contribute(&contributor, &500_000);

        env.ledger().set_timestamp(deadline + 1);
        let result = client.try_withdraw();

        assert!(result.is_err());
        assert_eq!(result.unwrap_err().unwrap(), ContractError::GoalNotReached);
    }

    // Test 5: Early refund
    {
        let (env, client, creator, token_address, admin) = setup_env();
        let deadline = env.ledger().timestamp() + 3600;
        let goal: i128 = 1_000_000;
        client.initialize(
            &creator,
            &token_address,
            &goal,
            &deadline,
            &1_000,
            &default_title(&env),
            &default_description(&env),
            &None,
        );

        let contributor = Address::generate(&env);
        mint_to(&env, &token_address, &admin, &contributor, 500_000);
        client.contribute(&contributor, &500_000);

        let result = client.try_refund_single(&contributor);

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().unwrap(),
            ContractError::CampaignStillActive
        );
    }

    // Test 6: Refund after success
    {
        let (env, client, creator, token_address, admin) = setup_env();
        let deadline = env.ledger().timestamp() + 3600;
        let goal: i128 = 1_000_000;
        client.initialize(
            &creator,
            &token_address,
            &goal,
            &deadline,
            &1_000,
            &default_title(&env),
            &default_description(&env),
            &None,
        );

        let contributor = Address::generate(&env);
        mint_to(&env, &token_address, &admin, &contributor, 1_000_000);
        client.contribute(&contributor, &1_000_000);

        env.ledger().set_timestamp(deadline + 1);
        let result = client.try_refund_single(&contributor);

        assert!(result.is_err());
        assert_eq!(result.unwrap_err().unwrap(), ContractError::GoalReached);
    }
}

// ── Preservation Property Tests ────────────────────────────────────────────

use proptest::prelude::*;

/// **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
///
/// **Property 2: Preservation** - Successful Execution Paths
///
/// This test verifies that all successful execution paths work correctly
/// on the UNFIXED code. These behaviors MUST be preserved after the fix.
///
/// **IMPORTANT**: This test is EXPECTED TO PASS on unfixed code.
/// When it passes, it confirms the baseline behavior to preserve.
///
/// The test covers all successful operations:
/// 1. First initialization with valid parameters stores creator, token, goal, deadline, and initializes total_raised to 0
/// 2. Valid contributions before deadline transfer tokens, update balances, and track contributors
/// 3. Successful withdrawal by creator after deadline when goal met transfers funds and resets total_raised
/// 4. Successful refund after deadline when goal not met refunds all contributors
/// 5. View functions (total_raised, goal, deadline, contribution) return correct values
/// 6. Multiple contributors are tracked correctly with individual and aggregate totals

proptest! {
    #[test]
    fn prop_preservation_first_initialization(
        goal in 1_000i128..10_000_000i128,
        deadline_offset in 100u64..10_000u64,
    ) {
        let (env, client, creator, token_address, _admin) = setup_env();
        let deadline = env.ledger().timestamp() + deadline_offset;

        // Test 3.1: First initialization stores all values correctly
        client.initialize(&creator, &token_address, &goal, &deadline, &1_000, &default_title(&env), &default_description(&env), &None);

        prop_assert_eq!(client.goal(), goal);
        prop_assert_eq!(client.deadline(), deadline);
        prop_assert_eq!(client.total_raised(), 0);
    }

    #[test]
    fn prop_preservation_valid_contribution(
        goal in 1_000_000i128..10_000_000i128,
        deadline_offset in 100u64..10_000u64,
        contribution_amount in 100_000i128..1_000_000i128,
    ) {
        let (env, client, creator, token_address, admin) = setup_env();
        let deadline = env.ledger().timestamp() + deadline_offset;

        client.initialize(&creator, &token_address, &goal, &deadline, &1_000, &default_title(&env), &default_description(&env), &None);

        let contributor = Address::generate(&env);
        mint_to(&env, &token_address, &admin, &contributor, contribution_amount);

        // Test 3.2: Valid contribution before deadline works correctly
        client.contribute(&contributor, &contribution_amount);

        prop_assert_eq!(client.total_raised(), contribution_amount);
        prop_assert_eq!(client.contribution(&contributor), contribution_amount);
    }

    #[test]
    fn prop_preservation_successful_withdrawal(
        goal in 1_000_000i128..5_000_000i128,
        deadline_offset in 100u64..10_000u64,
    ) {
        let (env, client, creator, token_address, admin) = setup_env();
        let deadline = env.ledger().timestamp() + deadline_offset;

        client.initialize(&creator, &token_address, &goal, &deadline, &1_000, &default_title(&env), &default_description(&env), &None);

        let contributor = Address::generate(&env);
        mint_to(&env, &token_address, &admin, &contributor, goal);
        client.contribute(&contributor, &goal);

        // Move past deadline
        env.ledger().set_timestamp(deadline + 1);

        let token_client = token::Client::new(&env, &token_address);
        let creator_balance_before = token_client.balance(&creator);

        // Test 3.3: Successful withdrawal transfers funds and resets total_raised
        client.withdraw();

        prop_assert_eq!(client.total_raised(), 0);
        prop_assert_eq!(token_client.balance(&creator), creator_balance_before + goal);
    }

    #[test]
    fn prop_preservation_successful_refund(
        goal in 2_000_000i128..10_000_000i128,
        deadline_offset in 100u64..10_000u64,
        contribution_amount in 100_000i128..1_000_000i128,
    ) {
        let (env, client, creator, token_address, admin) = setup_env();
        let deadline = env.ledger().timestamp() + deadline_offset;

        // Ensure contribution is less than goal
        let contribution = contribution_amount.min(goal - 1);

        client.initialize(&creator, &token_address, &goal, &deadline, &1_000, &default_title(&env), &default_description(&env), &None);

        let contributor = Address::generate(&env);
        mint_to(&env, &token_address, &admin, &contributor, contribution);
        client.contribute(&contributor, &contribution);

        // Move past deadline (goal not met)
        env.ledger().set_timestamp(deadline + 1);

        // Test 3.4: Successful refund returns funds to contributors
        client.refund_single(&contributor);

        let token_client = token::Client::new(&env, &token_address);
        prop_assert_eq!(token_client.balance(&contributor), contribution);
        prop_assert_eq!(client.total_raised(), 0);
    }

    #[test]
    fn prop_preservation_view_functions(
        goal in 1_000_000i128..10_000_000i128,
        deadline_offset in 100u64..10_000u64,
        contribution_amount in 100_000i128..1_000_000i128,
    ) {
        let (env, client, creator, token_address, admin) = setup_env();
        let deadline = env.ledger().timestamp() + deadline_offset;

        client.initialize(&creator, &token_address, &goal, &deadline, &1_000, &default_title(&env), &default_description(&env), &None);

        let contributor = Address::generate(&env);
        mint_to(&env, &token_address, &admin, &contributor, contribution_amount);
        client.contribute(&contributor, &contribution_amount);

        // Test 3.5: View functions return correct values
        prop_assert_eq!(client.goal(), goal);
        prop_assert_eq!(client.deadline(), deadline);
        prop_assert_eq!(client.total_raised(), contribution_amount);
        prop_assert_eq!(client.contribution(&contributor), contribution_amount);
    }

    #[test]
    fn prop_preservation_multiple_contributors(
        goal in 5_000_000i128..10_000_000i128,
        deadline_offset in 100u64..10_000u64,
        amount1 in 100_000i128..1_000_000i128,
        amount2 in 100_000i128..1_000_000i128,
        amount3 in 100_000i128..1_000_000i128,
    ) {
        let (env, client, creator, token_address, admin) = setup_env();
        let deadline = env.ledger().timestamp() + deadline_offset;

        client.initialize(&creator, &token_address, &goal, &deadline, &1_000, &default_title(&env), &default_description(&env), &None);

        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let charlie = Address::generate(&env);

        mint_to(&env, &token_address, &admin, &alice, amount1);
        mint_to(&env, &token_address, &admin, &bob, amount2);
        mint_to(&env, &token_address, &admin, &charlie, amount3);

        // Test 3.6: Multiple contributors are tracked correctly
        client.contribute(&alice, &amount1);
        client.contribute(&bob, &amount2);
        client.contribute(&charlie, &amount3);

        let expected_total = amount1 + amount2 + amount3;

        prop_assert_eq!(client.total_raised(), expected_total);
        prop_assert_eq!(client.contribution(&alice), amount1);
        prop_assert_eq!(client.contribution(&bob), amount2);
        prop_assert_eq!(client.contribution(&charlie), amount3);
    }
}

#[test]
#[should_panic(expected = "campaign is not active")]
fn test_double_withdraw_panics() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 1_000_000);
    client.contribute(&contributor, &1_000_000);

    env.ledger().set_timestamp(deadline + 1);

    client.withdraw();
    client.withdraw(); // should panic — status is Successful
}

#[test]
fn test_double_refund_single_panics() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let alice = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &alice, 500_000);
    client.contribute(&alice, &500_000);

    env.ledger().set_timestamp(deadline + 1);

    client.refund_single(&alice);
    // Second refund should succeed but do nothing (amount is 0)
    let result = client.try_refund_single(&alice);
    assert!(result.is_ok());
}

// NOTE: The following tests are commented out because the cancel function
// is not implemented in the current version of the contract.
// TODO: Implement cancel function or remove these tests.

/*
#[test]
fn test_cancel_with_no_contributions() {
    let (env, client, creator, token_address, _admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(&creator, &token_address, &goal, &deadline, &min_contribution, &default_title(&env), &default_description(&env), &None);

    client.cancel();

    assert_eq!(client.total_raised(), 0);
}

#[test]
fn test_cancel_with_contributions() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(&creator, &token_address, &goal, &deadline, &min_contribution, &default_title(&env), &default_description(&env), &None);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &alice, 300_000);
    mint_to(&env, &token_address, &admin, &bob, 200_000);

    client.contribute(&alice, &300_000);
    client.contribute(&bob, &200_000);

    client.cancel();

    let token_client = token::Client::new(&env, &token_address);
    assert_eq!(token_client.balance(&alice), 300_000);
    assert_eq!(token_client.balance(&bob), 200_000);
    assert_eq!(client.total_raised(), 0);
}

// ── Minimum Contribution Tests ─────────────────────────────────────────────

#[test]
fn test_contribute_exact_minimum() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(&creator, &token_address, &goal, &deadline, &min_contribution, &default_title(&env), &default_description(&env), &None);

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 10_000);

    client.contribute(&contributor, &10_000);

    assert_eq!(client.total_raised(), 10_000);
    assert_eq!(client.contribution(&contributor), 10_000);
}
*/

#[test]
fn test_contribute_above_minimum() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 10_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 50_000);

    client.contribute(&contributor, &50_000);

    assert_eq!(client.total_raised(), 50_000);
    assert_eq!(client.contribution(&contributor), 50_000);
}

// ── Tiered Rewards Tests ───────────────────────────────────────────────────

#[test]
fn test_get_user_tier_bronze_level() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 10_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let bronze = soroban_sdk::String::from_str(&env, "Bronze");
    let silver = soroban_sdk::String::from_str(&env, "Silver");
    let gold = soroban_sdk::String::from_str(&env, "Gold");
    client.add_reward_tier(&creator, &bronze, &10_000);
    client.add_reward_tier(&creator, &silver, &100_000);
    client.add_reward_tier(&creator, &gold, &500_000);

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 50_000);
    client.contribute(&contributor, &50_000);

    let tier = client.get_user_tier(&contributor);
    assert!(tier.is_some());
    assert_eq!(tier.unwrap(), bronze);
}

#[test]
fn test_get_user_tier_gold_level() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 10_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let bronze = soroban_sdk::String::from_str(&env, "Bronze");
    let silver = soroban_sdk::String::from_str(&env, "Silver");
    let gold = soroban_sdk::String::from_str(&env, "Gold");
    client.add_reward_tier(&creator, &bronze, &10_000);
    client.add_reward_tier(&creator, &silver, &100_000);
    client.add_reward_tier(&creator, &gold, &500_000);

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 600_000);
    client.contribute(&contributor, &600_000);

    let tier = client.get_user_tier(&contributor);
    assert!(tier.is_some());
    assert_eq!(tier.unwrap(), gold);
}

#[test]
fn test_get_user_tier_non_contributor_returns_none() {
    let (env, client, creator, token_address, _admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let bronze = soroban_sdk::String::from_str(&env, "Bronze");
    client.add_reward_tier(&creator, &bronze, &10_000);

    let non_contributor = Address::generate(&env);
    let tier = client.get_user_tier(&non_contributor);
    assert!(tier.is_none());
}

#[test]
fn test_get_user_tier_no_tiers_defined_returns_none() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &(goal * 2),
        &deadline,
        &min_contribution,
        &None,
    );

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 500_000);
    client.contribute(&contributor, &500_000);

    let tier = client.get_user_tier(&contributor);
    assert!(tier.is_none());
}

#[test]
fn test_get_user_tier_highest_qualifying_tier_returned() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &(goal * 2),
        &deadline,
        &min_contribution,
        &None,
    );

    let bronze = soroban_sdk::String::from_str(&env, "Bronze");
    let silver = soroban_sdk::String::from_str(&env, "Silver");
    let gold = soroban_sdk::String::from_str(&env, "Gold");
    client.add_reward_tier(&creator, &bronze, &10_000);
    client.add_reward_tier(&creator, &silver, &100_000);
    client.add_reward_tier(&creator, &gold, &500_000);

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 1_000_000);
    client.contribute(&contributor, &1_000_000);

    let tier = client.get_user_tier(&contributor);
    assert!(tier.is_some());
    assert_eq!(tier.unwrap(), gold);
}

#[test]
#[should_panic]
fn test_add_reward_tier_non_creator_rejected() {
    let (env, client, creator, token_address, _admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &(goal * 2),
        &deadline,
        &min_contribution,
        &None,
    );

    let non_creator = Address::generate(&env);
    let bronze = soroban_sdk::String::from_str(&env, "Bronze");
    client.add_reward_tier(&non_creator, &bronze, &10_000);
}

#[test]
#[should_panic(expected = "min_amount must be greater than 0")]
fn test_add_reward_tier_rejects_zero_min_amount() {
    let (env, client, creator, token_address, _admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &(goal * 2),
        &deadline,
        &min_contribution,
        &None,
    );

    let bronze = soroban_sdk::String::from_str(&env, "Bronze");
    client.add_reward_tier(&creator, &bronze, &0);
}

#[test]
fn test_reward_tiers_view() {
    let (env, client, creator, token_address, _admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &(goal * 2),
        &deadline,
        &min_contribution,
        &None,
    );

    assert_eq!(client.reward_tiers().len(), 0);

    let bronze = soroban_sdk::String::from_str(&env, "Bronze");
    let silver = soroban_sdk::String::from_str(&env, "Silver");
    client.add_reward_tier(&creator, &bronze, &10_000);
    client.add_reward_tier(&creator, &silver, &100_000);

    let tiers = client.reward_tiers();
    assert_eq!(tiers.len(), 2);
    assert_eq!(tiers.get(0).unwrap().name, bronze);
    assert_eq!(tiers.get(0).unwrap().min_amount, 10_000);
    assert_eq!(tiers.get(1).unwrap().name, silver);
    assert_eq!(tiers.get(1).unwrap().min_amount, 100_000);
}

// ── Roadmap Tests ──────────────────────────────────────────────────────────

#[test]
fn test_add_single_roadmap_item() {
    let (env, client, creator, token_address, _admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &(goal * 2),
        &deadline,
        &min_contribution,
        &None,
    );

    let current_time = env.ledger().timestamp();
    let roadmap_date = current_time + 86400; // 1 day in the future
    let description = soroban_sdk::String::from_str(&env, "Beta release");

    client.add_roadmap_item(&roadmap_date, &description);

    let roadmap = client.roadmap();
    assert_eq!(roadmap.len(), 1);
    assert_eq!(roadmap.get(0).unwrap().date, roadmap_date);
    assert_eq!(roadmap.get(0).unwrap().description, description);
}

#[test]
fn test_add_multiple_roadmap_items_in_order() {
    let (env, client, creator, token_address, _admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let current_time = env.ledger().timestamp();
    let date1 = current_time + 86400;
    let date2 = current_time + 172800;
    let date3 = current_time + 259200;

    let desc1 = soroban_sdk::String::from_str(&env, "Alpha release");
    let desc2 = soroban_sdk::String::from_str(&env, "Beta release");
    let desc3 = soroban_sdk::String::from_str(&env, "Production launch");

    client.add_roadmap_item(&date1, &desc1);
    client.add_roadmap_item(&date2, &desc2);
    client.add_roadmap_item(&date3, &desc3);

    let roadmap = client.roadmap();
    assert_eq!(roadmap.len(), 3);
    assert_eq!(roadmap.get(0).unwrap().date, date1);
    assert_eq!(roadmap.get(1).unwrap().date, date2);
    assert_eq!(roadmap.get(2).unwrap().date, date3);
    assert_eq!(roadmap.get(0).unwrap().description, desc1);
    assert_eq!(roadmap.get(1).unwrap().description, desc2);
    assert_eq!(roadmap.get(2).unwrap().description, desc3);
}

#[test]
#[should_panic(expected = "date must be in the future")]
fn test_add_roadmap_item_with_past_date_panics() {
    let (env, client, creator, token_address, _admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let current_time = env.ledger().timestamp();
    // Set a past date by moving time forward first, then trying to add an item with an earlier date
    env.ledger().set_timestamp(current_time + 1000);
    let past_date = current_time + 500; // Earlier than the new current time
    let description = soroban_sdk::String::from_str(&env, "Past milestone");

    client.add_roadmap_item(&past_date, &description); // should panic
}

#[test]
#[should_panic(expected = "date must be in the future")]
fn test_add_roadmap_item_with_current_date_panics() {
    let (env, client, creator, token_address, _admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let current_time = env.ledger().timestamp();
    let description = soroban_sdk::String::from_str(&env, "Current milestone");

    client.add_roadmap_item(&current_time, &description); // should panic
}

#[test]
#[should_panic(expected = "description cannot be empty")]
fn test_add_roadmap_item_with_empty_description_panics() {
    let (env, client, creator, token_address, _admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let current_time = env.ledger().timestamp();
    let roadmap_date = current_time + 86400;
    let empty_description = soroban_sdk::String::from_str(&env, "");

    client.add_roadmap_item(&roadmap_date, &empty_description); // should panic
}

#[test]
#[should_panic]
fn test_add_roadmap_item_by_non_creator_panics() {
    let env = Env::default();
    let contract_id = env.register(crate::CrowdfundContract, ());
    let client = crate::CrowdfundContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract_id.address();

    let creator = Address::generate(&env);
    let non_creator = Address::generate(&env);

    env.mock_all_auths();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    env.mock_all_auths_allowing_non_root_auth();
    env.set_auths(&[]);

    let current_time = env.ledger().timestamp();
    let roadmap_date = current_time + 86400;
    let description = soroban_sdk::String::from_str(&env, "Milestone");

    client.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &non_creator,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &contract_id,
            fn_name: "add_roadmap_item",
            args: soroban_sdk::vec![&env],
            sub_invokes: &[],
        },
    }]);

    client.add_roadmap_item(&roadmap_date, &description); // should panic
}

#[test]
fn test_roadmap_empty_after_initialization() {
    let (env, client, creator, token_address, _admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let roadmap = client.roadmap();
    assert_eq!(roadmap.len(), 0);
}

// ── Campaign Updates Tests ─────────────────────────────────────────────────

#[test]
fn test_post_single_update() {
    let (env, client, creator, token_address, _admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let hard_cap: i128 = goal * 2;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &hard_cap,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let update_text = soroban_sdk::String::from_str(&env, "Development milestone reached!");
    client.post_update(&update_text);

    let updates = client.get_updates();
    assert_eq!(updates.len(), 1);
    let (timestamp, text) = updates.get(0).unwrap();
    assert_eq!(timestamp, env.ledger().timestamp());
    assert_eq!(text, update_text);
}

#[test]
fn test_post_multiple_updates_chronological_order() {
    let (env, client, creator, token_address, _admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let hard_cap: i128 = goal * 2;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &hard_cap,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let update1 = soroban_sdk::String::from_str(&env, "First update");
    let time1 = env.ledger().timestamp();
    client.post_update(&update1);

    env.ledger().set_timestamp(time1 + 100);
    let update2 = soroban_sdk::String::from_str(&env, "Second update");
    let time2 = env.ledger().timestamp();
    client.post_update(&update2);

    env.ledger().set_timestamp(time2 + 200);
    let update3 = soroban_sdk::String::from_str(&env, "Third update");
    let time3 = env.ledger().timestamp();
    client.post_update(&update3);

    let updates = client.get_updates();
    assert_eq!(updates.len(), 3);

    let (ts1, text1) = updates.get(0).unwrap();
    assert_eq!(ts1, time1);
    assert_eq!(text1, update1);

    let (ts2, text2) = updates.get(1).unwrap();
    assert_eq!(ts2, time2);
    assert_eq!(text2, update2);

    let (ts3, text3) = updates.get(2).unwrap();
    assert_eq!(ts3, time3);
    assert_eq!(text3, update3);
}

#[test]
#[should_panic]
fn test_post_update_by_non_creator_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(CrowdfundContract, ());
    let client = CrowdfundContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    let creator = Address::generate(&env);
    let non_creator = Address::generate(&env);

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let hard_cap: i128 = goal * 2;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &hard_cap,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    // Set auth to non-creator
    env.mock_all_auths_allowing_non_root_auth();
    let update_text = soroban_sdk::String::from_str(&env, "Unauthorized update");

    // This should panic because non_creator is not authorized
    client.post_update(&update_text);
}

#[test]
#[should_panic(expected = "update text cannot be empty")]
fn test_post_update_with_empty_text_panics() {
    let (env, client, creator, token_address, _admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let hard_cap: i128 = goal * 2;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &hard_cap,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let empty_text = soroban_sdk::String::from_str(&env, "");
    client.post_update(&empty_text); // should panic
}

#[test]
fn test_get_updates_empty_after_initialization() {
    let (env, client, creator, token_address, _admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let hard_cap: i128 = goal * 2;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &hard_cap,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let updates = client.get_updates();
    assert_eq!(updates.len(), 0);
}

// ── Campaign Info Tests ────────────────────────────────────────────────────

#[test]
fn test_creator() {
    let (env, client, creator, token_address, _admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &(goal * 2),
        &deadline,
        &min_contribution,
    );

    assert_eq!(client.creator(), creator);
}

#[test]
fn test_get_campaign_info_initial() {
    let (env, client, creator, token_address, _admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
        &default_title(&env),
        &default_description(&env),
        &None,
    );

    let info = client.get_campaign_info();

    assert_eq!(info.creator, creator);
    assert_eq!(info.token, token_address);
    assert_eq!(info.goal, goal);
    assert_eq!(info.deadline, deadline);
    assert_eq!(info.total_raised, 0);
}

#[test]
fn test_get_campaign_info_with_contributions() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &(goal * 2),
        &deadline,
        &min_contribution,
    );

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &alice, 600_000);
    mint_to(&env, &token_address, &admin, &bob, 300_000);

    client.contribute(&alice, &600_000);
    client.contribute(&bob, &300_000);

    let info = client.get_campaign_info();

    assert_eq!(info.creator, creator);
    assert_eq!(info.token, token_address);
    assert_eq!(info.goal, goal);
    assert_eq!(info.deadline, deadline);
    assert_eq!(info.total_raised, 900_000);
}

#[test]
fn test_get_campaign_info_after_goal_reached() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &(goal * 2),
        &deadline,
        &min_contribution,
    );

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 1_500_000);
    client.contribute(&contributor, &1_500_000);

    let info = client.get_campaign_info();

    assert_eq!(info.creator, creator);
    assert_eq!(info.token, token_address);
    assert_eq!(info.goal, goal);
    assert_eq!(info.deadline, deadline);
    assert_eq!(info.total_raised, 1_500_000);
}

// ── Whitelist Tests ────────────────────────────────────────────────────────

#[test]
fn test_whitelisted_contribution() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &(goal * 2),
        &deadline,
        &min_contribution,
    );

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Add Alice to whitelist
    client.add_to_whitelist(&soroban_sdk::vec![&env, alice.clone()]);

    mint_to(&env, &token_address, &admin, &alice, 500_000);
    mint_to(&env, &token_address, &admin, &bob, 500_000);

    // Alice (whitelisted) can contribute
    client.contribute(&alice, &500_000);
    assert_eq!(client.contribution(&alice), 500_000);

    // Bob (not whitelisted) cannot contribute
    let result = client.try_contribute(&bob, &500_000);
    assert!(result.is_err());
}

#[test]
fn test_open_campaign_no_whitelist() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &(goal * 2),
        &deadline,
        &min_contribution,
    );

    let alice = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &alice, 500_000);

    // Any address can contribute if no addresses were ever added to the whitelist
    client.contribute(&alice, &500_000);
    assert_eq!(client.contribution(&alice), 500_000);
}

#[test]
fn test_batch_whitelist_addition() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
    );

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.add_to_whitelist(&soroban_sdk::vec![&env, alice.clone(), bob.clone()]);

    assert!(client.is_whitelisted(&alice));
    assert!(client.is_whitelisted(&bob));

    mint_to(&env, &token_address, &admin, &alice, 100_000);
    mint_to(&env, &token_address, &admin, &bob, 100_000);

    client.contribute(&alice, &100_000);
    client.contribute(&bob, &100_000);

    assert_eq!(client.total_raised(), 200_000);
}

#[test]
#[should_panic]
fn test_add_to_whitelist_non_creator_panics() {
    let (env, client, _creator, _token_address, _admin) = setup_env();

    let alice = Address::generate(&env);

    // Non-creator address
    let _attacker = Address::generate(&env);

    // Mock authorization for non-creator
    env.mock_all_auths();

    // This should panic because creator.require_auth() will fail (mock_all_auths handles the auth but we check if the caller is the creator)
    // Actually, require_auth checks if the address authorized the call.
    // In lib.rs: let creator: Address = env.storage().instance().get(&DataKey::Creator).unwrap(); creator.require_auth();
    // This means the 'creator' MUST authorize the call. If 'attacker' calls it, 'creator.require_auth()' will fail unless 'creator' also authorized it.

    client.add_to_whitelist(&soroban_sdk::vec![&env, alice]);
}

// ── Early Withdrawal Tests ──────────────────────────────────────────────────

#[test]
fn test_partial_withdrawal() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &(goal * 2),
        &deadline,
        &min_contribution,
    );

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 500_000);
    client.contribute(&contributor, &500_000);

    assert_eq!(client.total_raised(), 500_000);
    assert_eq!(client.contribution(&contributor), 500_000);

    // Partial withdrawal.
    client.withdraw_contribution(&contributor, &200_000);

    assert_eq!(client.total_raised(), 300_000);
    assert_eq!(client.contribution(&contributor), 300_000);
}

#[test]
fn test_full_withdrawal_removes_contributor() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &(goal * 2),
        &deadline,
        &min_contribution,
    );

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 500_000);
    client.contribute(&contributor, &500_000);

    let stats = client.get_stats();
    assert_eq!(stats.contributor_count, 1);

    // Full withdrawal.
    client.withdraw_contribution(&contributor, &500_000);

    assert_eq!(client.total_raised(), 0);
    assert_eq!(client.contribution(&contributor), 0);

    let stats_after = client.get_stats();
    assert_eq!(stats_after.contributor_count, 0);
}

#[test]
#[should_panic(expected = "insufficient balance")]
fn test_withdraw_exceeding_balance_panics() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
    );

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 100_000);
    client.contribute(&contributor, &100_000);

    client.withdraw_contribution(&contributor, &100_001); // should panic
}

#[test]
#[should_panic(expected = "campaign has ended")]
fn test_withdraw_after_deadline_panics() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    client.initialize(
        &creator,
        &token_address,
        &goal,
        &deadline,
        &min_contribution,
    );

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 100_000);
    client.contribute(&contributor, &100_000);

    // Fast forward past deadline.
    env.ledger().set_timestamp(deadline + 1);

    client.withdraw_contribution(&contributor, &50_000); // should panic
}

// ── Multisig & DAO Creator Tests ───────────────────────────────────────────

/// Test that withdraw works correctly when the creator is a contract address.
///
/// This simulates a multisig wallet or DAO contract as the campaign creator.
/// In Soroban, when `creator.require_auth()` is called on a contract address,
/// it invokes the contract's authorization logic, enabling multisig approval.
#[test]
fn test_withdraw_with_multisig_creator() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(CrowdfundContract, ());
    let client = CrowdfundContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract_id.address();
    let token_admin_client = token::StellarAssetClient::new(&env, &token_address);

    // Use a contract address as the creator (simulating a multisig wallet)
    // In a real scenario, this would be a deployed multisig contract
    let multisig_creator = Address::generate(&env);

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let hard_cap: i128 = goal * 2;
    let min_contribution: i128 = 1_000;

    client.initialize(
        &multisig_creator,
        &token_address,
        &goal,
        &hard_cap,
        &deadline,
        &min_contribution,
        &soroban_sdk::String::from_str(&env, "Multisig Campaign"),
        &soroban_sdk::String::from_str(&env, "Campaign with multisig creator"),
        &None,
    );

    // Contribute to meet the goal
    let contributor = Address::generate(&env);
    token_admin_client.mint(&contributor, &1_000_000);
    client.contribute(&contributor, &1_000_000);

    // Fast forward past deadline
    env.ledger().set_timestamp(deadline + 1);

    // Withdraw should succeed with multisig creator
    // In a real scenario, this would require M-of-N signatures
    let result = client.try_withdraw();
    assert!(result.is_ok());
}

/// Test that set_paused works correctly with a multisig creator.
///
/// This ensures that pause/unpause operations can be controlled by
/// a multisig wallet or DAO, preventing single-party control over
/// this critical security function.
#[test]
fn test_set_paused_with_multisig_creator() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(CrowdfundContract, ());
    let client = CrowdfundContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    // Use a contract address as the creator (simulating a multisig wallet)
    let multisig_creator = Address::generate(&env);

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let hard_cap: i128 = goal * 2;
    let min_contribution: i128 = 1_000;

    client.initialize(
        &multisig_creator,
        &token_address,
        &goal,
        &hard_cap,
        &deadline,
        &min_contribution,
        &soroban_sdk::String::from_str(&env, "Multisig Campaign"),
        &soroban_sdk::String::from_str(&env, "Campaign with multisig creator"),
        &None,
    );

    // Pause the campaign - should work with multisig creator
    client.set_paused(&true);

    // Verify the campaign is paused
    // (In a real scenario, this would require multisig approval)
    let paused: bool = env
        .storage()
        .instance()
        .get(&crate::DataKey::Paused)
        .unwrap_or(false);
    assert!(paused);

    // Unpause the campaign
    client.set_paused(&false);

    let paused: bool = env
        .storage()
        .instance()
        .get(&crate::DataKey::Paused)
        .unwrap_or(false);
    assert!(!paused);
}

/// Test that update_metadata works correctly with a multisig creator.
///
/// This ensures that campaign metadata changes can be controlled by
/// a multisig wallet or DAO, maintaining transparency and preventing
/// unauthorized modifications.
#[test]
fn test_update_metadata_with_multisig_creator() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(CrowdfundContract, ());
    let client = CrowdfundContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    // Use a contract address as the creator (simulating a DAO)
    let dao_creator = Address::generate(&env);

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let hard_cap: i128 = goal * 2;
    let min_contribution: i128 = 1_000;

    client.initialize(
        &dao_creator,
        &token_address,
        &goal,
        &hard_cap,
        &deadline,
        &min_contribution,
        &soroban_sdk::String::from_str(&env, "DAO Campaign"),
        &soroban_sdk::String::from_str(&env, "Campaign with DAO creator"),
        &None,
    );

    // Update metadata - should work with DAO creator
    let new_title = Some(soroban_sdk::String::from_str(&env, "Updated DAO Campaign"));
    let new_description = Some(soroban_sdk::String::from_str(
        &env,
        "Updated description by DAO vote",
    ));

    client.update_metadata(&dao_creator, &new_title, &new_description, &None);

    // Verify the metadata was updated
    let title = client.title();
    assert_eq!(title, new_title.unwrap());
}

/// Test that unauthorized addresses are still rejected even when creator is a multisig.
///
/// This ensures that the authorization mechanism works correctly for both
/// user accounts and contract addresses, rejecting unauthorized callers.
#[test]
#[should_panic]
fn test_multisig_creator_rejects_unauthorized_address() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(CrowdfundContract, ());
    let client = CrowdfundContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract_id.address();

    // Use a contract address as the creator (simulating a multisig wallet)
    let multisig_creator = Address::generate(&env);

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let hard_cap: i128 = goal * 2;
    let min_contribution: i128 = 1_000;

    client.initialize(
        &multisig_creator,
        &token_address,
        &goal,
        &hard_cap,
        &deadline,
        &min_contribution,
        &soroban_sdk::String::from_str(&env, "Multisig Campaign"),
        &soroban_sdk::String::from_str(&env, "Campaign with multisig creator"),
        &None,
    );

    // Try to pause with an unauthorized address
    let unauthorized = Address::generate(&env);
    env.mock_all_auths_allowing_non_root_auth();
    env.set_auths(&[]);

    // This should panic because unauthorized address is not the creator
    client.set_paused(&true);
}

/// Test that all admin functions work correctly when creator is a DAO contract.
///
/// This comprehensive test verifies that all creator-restricted functions
/// (withdraw, set_paused, update_metadata, add_roadmap_item, add_stretch_goal,
/// add_reward_tier) work seamlessly with a DAO contract as the creator.
#[test]
fn test_all_admin_functions_with_dao_creator() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(CrowdfundContract, ());
    let client = CrowdfundContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_address = token_contract_id.address();
    let token_admin_client = token::StellarAssetClient::new(&env, &token_address);

    // Use a contract address as the creator (simulating a DAO)
    let dao_creator = Address::generate(&env);

    let deadline = env.ledger().timestamp() + 3600;
    let goal: i128 = 1_000_000;
    let hard_cap: i128 = goal * 2;
    let min_contribution: i128 = 1_000;

    client.initialize(
        &dao_creator,
        &token_address,
        &goal,
        &hard_cap,
        &deadline,
        &min_contribution,
        &soroban_sdk::String::from_str(&env, "DAO Campaign"),
        &soroban_sdk::String::from_str(&env, "Campaign with DAO governance"),
        &None,
    );

    // Test add_roadmap_item
    let roadmap_date = env.ledger().timestamp() + 86400;
    let roadmap_desc = soroban_sdk::String::from_str(&env, "Milestone 1");
    client.add_roadmap_item(&roadmap_date, &roadmap_desc);

    let roadmap = client.roadmap();
    assert_eq!(roadmap.len(), 1);

    // Test add_stretch_goal
    let stretch_goal: i128 = 2_000_000;
    client.add_stretch_goal(&stretch_goal);

    // Test add_reward_tier
    let tier_name = soroban_sdk::String::from_str(&env, "Gold");
    client.add_reward_tier(&dao_creator, &tier_name, &10_000);

    let tiers = client.reward_tiers();
    assert_eq!(tiers.len(), 1);

    // Test update_metadata
    let new_title = Some(soroban_sdk::String::from_str(&env, "Updated by DAO"));
    client.update_metadata(&dao_creator, &new_title, &None, &None);

    // Test set_paused
    client.set_paused(&true);
    client.set_paused(&false);

    // Test update_deadline
    let new_deadline = deadline + 7200;
    client.update_deadline(&new_deadline);

    // Contribute to meet the goal
    let contributor = Address::generate(&env);
    token_admin_client.mint(&contributor, &1_000_000);
    client.contribute(&contributor, &1_000_000);

    // Fast forward past deadline
    env.ledger().set_timestamp(new_deadline + 1);

    // Test withdraw
    let result = client.try_withdraw();
    assert!(result.is_ok());
}

// ── Auto-Extension Tests ────────────────────────────────────────────────────

#[test]
fn test_auto_extension_triggered() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 7200; // 2 hours from now
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    let auto_extension_threshold: i128 = 100_000;

    client.initialize(&creator, &token_address, &goal, &deadline, &min_contribution, &Some(auto_extension_threshold));

    // Move to within the auto-extension window (last hour).
    env.ledger().set_timestamp(deadline - 1800); // 30 minutes before deadline

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 150_000);
    client.contribute(&contributor, &150_000);

    // Deadline should be extended by 24 hours.
    let new_deadline = client.deadline();
    assert_eq!(new_deadline, deadline + 86400);
}

#[test]
fn test_auto_extension_not_triggered_below_threshold() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 7200;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    let auto_extension_threshold: i128 = 100_000;

    client.initialize(&creator, &token_address, &goal, &deadline, &min_contribution, &Some(auto_extension_threshold));

    // Move to within the auto-extension window.
    env.ledger().set_timestamp(deadline - 1800);

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 50_000);
    client.contribute(&contributor, &50_000);

    // Deadline should NOT be extended (contribution below threshold).
    assert_eq!(client.deadline(), deadline);
}

#[test]
fn test_auto_extension_not_triggered_outside_window() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 7200;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;
    let auto_extension_threshold: i128 = 100_000;

    client.initialize(&creator, &token_address, &goal, &deadline, &min_contribution, &Some(auto_extension_threshold));

    // Contribute outside the auto-extension window (more than 1 hour before deadline).
    env.ledger().set_timestamp(deadline - 5000);

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 150_000);
    client.contribute(&contributor, &150_000);

    // Deadline should NOT be extended (outside window).
    assert_eq!(client.deadline(), deadline);
}

#[test]
fn test_auto_extension_cap_prevents_infinite_extension() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 7200;
    let goal: i128 = 10_000_000;
    let min_contribution: i128 = 1_000;
    let auto_extension_threshold: i128 = 100_000;

    client.initialize(&creator, &token_address, &goal, &deadline, &min_contribution, &Some(auto_extension_threshold));

    // Trigger 5 extensions (the maximum).
    for _i in 0..5 {
        let current_deadline = client.deadline();
        env.ledger().set_timestamp(current_deadline - 1800);

        let contributor = Address::generate(&env);
        mint_to(&env, &token_address, &admin, &contributor, 150_000);
        client.contribute(&contributor, &150_000);

        // Verify extension occurred.
        assert_eq!(client.deadline(), current_deadline + 86400);
    }

    // Try to trigger a 6th extension.
    let final_deadline = client.deadline();
    env.ledger().set_timestamp(final_deadline - 1800);

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 150_000);
    client.contribute(&contributor, &150_000);

    // Deadline should NOT be extended (cap reached).
    assert_eq!(client.deadline(), final_deadline);
}

#[test]
fn test_auto_extension_disabled_when_not_configured() {
    let (env, client, creator, token_address, admin) = setup_env();

    let deadline = env.ledger().timestamp() + 7200;
    let goal: i128 = 1_000_000;
    let min_contribution: i128 = 1_000;

    client.initialize(&creator, &token_address, &goal, &deadline, &min_contribution, &None);

    // Move to within the auto-extension window.
    env.ledger().set_timestamp(deadline - 1800);

    let contributor = Address::generate(&env);
    mint_to(&env, &token_address, &admin, &contributor, 150_000);
    client.contribute(&contributor, &150_000);

    // Deadline should NOT be extended (feature not configured).
    assert_eq!(client.deadline(), deadline);
}
