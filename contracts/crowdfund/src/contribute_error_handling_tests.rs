//! Tests for contribute() error handling — typed errors replacing old panics.

use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token, Address, Env, Symbol,
};

use crate::{contribute_error_handling, ContractError, CrowdfundContract, CrowdfundContractClient};

// ── helpers ──────────────────────────────────────────────────────────────────

const GOAL: i128 = 1_000;
const MIN: i128 = 10;
const DEADLINE_OFFSET: u64 = 1_000;

fn setup() -> (Env, CrowdfundContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(CrowdfundContract, ());
    let client = CrowdfundContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token_id.address();
    let asset_client = token::StellarAssetClient::new(&env, &token_addr);

    let creator = Address::generate(&env);
    let contributor = Address::generate(&env);

    asset_client.mint(&contributor, &i128::MAX);

    let now = env.ledger().timestamp();
    client.initialize(
        &Address::generate(&env),
        &creator,
        &token_addr,
        &GOAL,
        &(now + DEADLINE_OFFSET),
        &MIN,
        &None,
        &None,
        &None,
    );

    (env, client, contributor, token_addr)
}

// ── happy path ───────────────────────────────────────────────────────────────

#[test]
fn contribute_happy_path() {
    let (env, client, contributor, _) = setup();
    env.ledger().set_timestamp(env.ledger().timestamp() + 1);
    client.contribute(&contributor, &MIN);
    assert_eq!(client.contribution(&contributor), MIN);
    assert_eq!(client.total_raised(), MIN);
}

#[test]
fn contribute_accumulates_multiple_contributions() {
    let (env, client, contributor, _) = setup();
    env.ledger().set_timestamp(env.ledger().timestamp() + 1);
    client.contribute(&contributor, &MIN);
    client.contribute(&contributor, &MIN);
    assert_eq!(client.contribution(&contributor), MIN * 2);
    assert_eq!(client.total_raised(), MIN * 2);
}

// ── CampaignEnded ─────────────────────────────────────────────────────────────

#[test]
fn contribute_after_deadline_returns_campaign_ended() {
    let (env, client, contributor, _) = setup();
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + DEADLINE_OFFSET + 1);
    let result = client.try_contribute(&contributor, &MIN);
    assert_eq!(result.unwrap_err().unwrap(), ContractError::CampaignEnded);
}

#[test]
fn contribute_exactly_at_deadline_is_accepted() {
    let (env, client, contributor, _) = setup();
    let deadline = client.deadline();
    env.ledger().set_timestamp(deadline);
    client.contribute(&contributor, &MIN);
    assert_eq!(client.total_raised(), MIN);
}

// ── BelowMinimum (typed — replaces old panic) ─────────────────────────────────

#[test]
fn contribute_below_minimum_returns_typed_error() {
    let (env, client, contributor, _) = setup();
    env.ledger().set_timestamp(env.ledger().timestamp() + 1);
    let result = client.try_contribute(&contributor, &(MIN - 1));
    assert_eq!(result.unwrap_err().unwrap(), ContractError::BelowMinimum);
}

#[test]
fn contribute_one_below_minimum_returns_below_minimum() {
    let (env, client, contributor, _) = setup();
    env.ledger().set_timestamp(env.ledger().timestamp() + 1);
    let result = client.try_contribute(&contributor, &1);
    assert_eq!(result.unwrap_err().unwrap(), ContractError::BelowMinimum);
}

// ── ZeroAmount (typed — replaces old pass-through) ────────────────────────────

#[test]
fn contribute_zero_amount_returns_typed_error() {
    let (env, client, contributor, _) = setup();
    env.ledger().set_timestamp(env.ledger().timestamp() + 1);
    let result = client.try_contribute(&contributor, &0);
    assert_eq!(result.unwrap_err().unwrap(), ContractError::ZeroAmount);
}

// ── CampaignNotActive (typed — new guard) ─────────────────────────────────────

#[test]
fn contribute_to_cancelled_campaign_returns_not_active() {
    let (env, client, contributor, _) = setup();
    env.ledger().set_timestamp(env.ledger().timestamp() + 1);
    client.cancel();
    let result = client.try_contribute(&contributor, &MIN);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ContractError::CampaignNotActive
    );
}

#[test]
fn contribute_to_successful_campaign_returns_not_active() {
    let (env, client, contributor, token_addr) = setup();
    env.ledger().set_timestamp(env.ledger().timestamp() + 1);
    // Fund to goal
    client.contribute(&contributor, &GOAL);
    // Advance past deadline and withdraw
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + DEADLINE_OFFSET);
    client.finalize();
    client.withdraw();
    // Now try to contribute
    let result = client.try_contribute(&contributor, &MIN);
    assert_eq!(
        result.unwrap_err().unwrap(),
        ContractError::CampaignNotActive
    );
    let _ = token_addr; // suppress unused warning
}

// ── Overflow error code constant ──────────────────────────────────────────────

#[test]
fn overflow_error_code_is_correct() {
    assert_eq!(contribute_error_handling::error_codes::OVERFLOW, 6);
    assert_eq!(ContractError::Overflow as u32, 6);
}

// ── error_codes helpers ───────────────────────────────────────────────────────

#[test]
fn describe_error_campaign_ended() {
    assert_eq!(
        contribute_error_handling::describe_error(
            contribute_error_handling::error_codes::CAMPAIGN_ENDED
        ),
        "Campaign has ended"
    );
}

#[test]
fn describe_error_overflow() {
    assert_eq!(
        contribute_error_handling::describe_error(contribute_error_handling::error_codes::OVERFLOW),
        "Arithmetic overflow — contribution amount too large"
    );
}

#[test]
fn describe_error_zero_amount() {
    assert_eq!(
        contribute_error_handling::describe_error(
            contribute_error_handling::error_codes::ZERO_AMOUNT
        ),
        "Contribution amount must be greater than zero"
    );
}

#[test]
fn describe_error_below_minimum() {
    assert_eq!(
        contribute_error_handling::describe_error(
            contribute_error_handling::error_codes::BELOW_MINIMUM
        ),
        "Contribution amount is below the minimum required"
    );
}

#[test]
fn describe_error_campaign_not_active() {
    assert_eq!(
        contribute_error_handling::describe_error(
            contribute_error_handling::error_codes::CAMPAIGN_NOT_ACTIVE
        ),
        "Campaign is not active"
    );
}

#[test]
fn describe_error_unknown() {
    assert_eq!(
        contribute_error_handling::describe_error(99),
        "Unknown error"
    );
}

#[test]
fn is_retryable_returns_false_for_all_known_errors() {
    for code in [
        contribute_error_handling::error_codes::CAMPAIGN_ENDED,
        contribute_error_handling::error_codes::OVERFLOW,
        contribute_error_handling::error_codes::ZERO_AMOUNT,
        contribute_error_handling::error_codes::BELOW_MINIMUM,
        contribute_error_handling::error_codes::CAMPAIGN_NOT_ACTIVE,
    ] {
        assert!(!contribute_error_handling::is_retryable(code));
    }
}

// ── logging bounds: error events are emitted ─────────────────────────────────

/// Returns the last `contribute_error` event as `(variant_symbol, error_code)`.
fn last_contribute_error_event(env: &Env) -> Option<(soroban_sdk::Symbol, u32)> {
    let topic0_str = soroban_sdk::String::from_str(env, "contribute_error");
    env.events()
        .all()
        .iter()
        .rev()
        .find_map(|(_, topics, data)| {
            if topics.len() < 2 {
                return None;
            }
            let v0 = topics.get(0)?;
            let t0 = soroban_sdk::String::try_from_val(env, &v0).ok()?;
            if t0 != topic0_str {
                return None;
            }
            let v1 = topics.get(1)?;
            let t1 = soroban_sdk::Symbol::try_from_val(env, &v1).ok()?;
            let code = u32::try_from_val(env, &data).ok()?;
            Some((t1, code))
        })
}

#[test]
fn error_event_emitted_on_campaign_ended() {
    let (env, client, contributor, _) = setup();
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + DEADLINE_OFFSET + 1);
    let _ = client.try_contribute(&contributor, &MIN);
    let (variant, code) = last_contribute_error_event(&env).expect("no event emitted");
    assert_eq!(variant, Symbol::new(&env, "CampaignEnded"));
    assert_eq!(code, contribute_error_handling::error_codes::CAMPAIGN_ENDED);
}

#[test]
fn error_event_emitted_on_zero_amount() {
    let (env, client, contributor, _) = setup();
    env.ledger().set_timestamp(env.ledger().timestamp() + 1);
    let _ = client.try_contribute(&contributor, &0);
    let (variant, code) = last_contribute_error_event(&env).expect("no event emitted");
    assert_eq!(variant, Symbol::new(&env, "ZeroAmount"));
    assert_eq!(code, contribute_error_handling::error_codes::ZERO_AMOUNT);
}

#[test]
fn error_event_emitted_on_below_minimum() {
    let (env, client, contributor, _) = setup();
    env.ledger().set_timestamp(env.ledger().timestamp() + 1);
    let _ = client.try_contribute(&contributor, &(MIN - 1));
    let (variant, code) = last_contribute_error_event(&env).expect("no event emitted");
    assert_eq!(variant, Symbol::new(&env, "BelowMinimum"));
    assert_eq!(code, contribute_error_handling::error_codes::BELOW_MINIMUM);
}

#[test]
fn error_event_emitted_on_campaign_not_active() {
    let (env, client, contributor, _) = setup();
    env.ledger().set_timestamp(env.ledger().timestamp() + 1);
    client.cancel();
    let _ = client.try_contribute(&contributor, &MIN);
    let (variant, code) = last_contribute_error_event(&env).expect("no event emitted");
    assert_eq!(variant, Symbol::new(&env, "CampaignNotActive"));
    assert_eq!(
        code,
        contribute_error_handling::error_codes::CAMPAIGN_NOT_ACTIVE
    );
}

#[test]
fn no_error_event_emitted_on_success() {
    let (env, client, contributor, _) = setup();
    env.ledger().set_timestamp(env.ledger().timestamp() + 1);
    client.contribute(&contributor, &MIN);
    assert!(last_contribute_error_event(&env).is_none());
}
