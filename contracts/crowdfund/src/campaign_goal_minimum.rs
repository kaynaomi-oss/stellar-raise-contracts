//! # campaign_goal_minimum
//!
//! @title   CampaignGoalMinimum — Extracted constants and enforcement logic
//!          for campaign goal and minimum contribution threshold validation.
//!
//! @notice  This module centralizes every magic number and threshold used
//!          during campaign initialization and contribution validation.
//!          Extracting them into named constants eliminates repeated literals
//!          scattered across the contract, reduces the risk of inconsistent
//!          values, and makes the intent of each guard immediately clear to
//!          reviewers.
//!
//! @dev     All constants are `pub` so that `lib.rs` and test modules can
//!          import them from a single source of truth.  No runtime state is
//!          held here — this module is purely compile-time constants plus
//!          pure validation helpers.
//!
//! ## Gas-efficiency rationale
//!
//! Before this refactor the contract contained inline literals such as
//! `10_000` (fee cap in bps), `0` (zero-amount guard), and the minimum-goal
//! floor.  Each occurrence forced the reader to infer intent from context and
//! made audits error-prone.  Named constants:
//!
//! - Are resolved at compile time — zero runtime cost.
//! - Appear in a single place, so a future change touches one line.
//! - Enable the compiler to catch type mismatches at the call site.
//!
//! ## Security assumptions
//!
//! 1. `MIN_GOAL_AMOUNT` prevents campaigns with a zero or trivially small
//!    goal that could be exploited to immediately trigger "goal reached" and
//!    allow the creator to withdraw dust amounts.
//! 2. `MIN_CONTRIBUTION_AMOUNT` prevents zero-amount contributions that waste
//!    gas on a no-op token transfer and pollute the contributors list.
//! 3. `MAX_PLATFORM_FEE_BPS` caps the platform fee at 100 % (10 000 bps) so
//!    the contract can never be configured to steal all contributor funds.
//! 4. `PROGRESS_BPS_SCALE` is the single authoritative scale factor for all
//!    basis-point progress calculations; using it everywhere prevents
//!    off-by-one errors when the scale changes.
//! 5. `MIN_DEADLINE_OFFSET` ensures the campaign deadline is always in the
//!    future relative to the ledger timestamp at initialization, preventing
//!    campaigns that are dead-on-arrival.
//!
//! ## Validation flow
//!
//! ```text
//! initialize(goal, min_contribution, deadline, platform_config)
//!        │
//!        ├─► validate_goal(goal)
//!        │       └─ goal >= MIN_GOAL_AMOUNT  ──► Ok / Err::GoalBelowMinimum
//!        │
//!        ├─► validate_min_contribution(min_contribution)
//!        │       └─ min_contribution >= MIN_CONTRIBUTION_AMOUNT
//!        │                              ──► Ok / Err::MinContributionBelowFloor
//!        │
//!        ├─► validate_deadline(now, deadline)
//!        │       └─ deadline >= now + MIN_DEADLINE_OFFSET
//!        │                              ──► Ok / Err::DeadlineTooSoon
//!        │
//!        └─► validate_platform_fee(fee_bps)
//!                └─ fee_bps <= MAX_PLATFORM_FEE_BPS
//!                               ──► Ok / Err::FeeTooHigh
//! ```

#![no_std]

// ── Constants ────────────────────────────────────────────────────────────────

/// Minimum allowed campaign goal (in the token's smallest unit).
///
/// A goal of zero would let the creator withdraw immediately after any
/// contribution, effectively turning the contract into a donation drain.
/// Setting a floor of 1 prevents this while remaining permissive enough for
/// test environments.
pub const MIN_GOAL_AMOUNT: i128 = 1;

/// Minimum allowed value for the `min_contribution` parameter.
///
/// Prevents the contract from being initialised with a zero minimum, which
/// would allow zero-amount contributions to waste gas and pollute storage.
pub const MIN_CONTRIBUTION_AMOUNT: i128 = 1;

/// Maximum platform fee expressed in basis points (1 bps = 0.01 %).
///
/// 10 000 bps == 100 %.  A fee above this would mean the platform takes more
/// than the total raised, leaving the creator with a negative payout.
pub const MAX_PLATFORM_FEE_BPS: u32 = 10_000;

/// Scale factor used for all basis-point progress calculations.
///
/// `progress_bps = (total_raised * PROGRESS_BPS_SCALE) / goal`
///
/// Keeping this as a named constant means every progress calculation in the
/// contract references the same value and a future change (e.g. to parts-per-
/// million) only requires editing one line.
pub const PROGRESS_BPS_SCALE: i128 = 10_000;

/// Minimum number of ledger seconds the deadline must be in the future at
/// initialisation time.
///
/// Prevents campaigns that expire before a single transaction can be
/// submitted.  Set to 60 seconds — one ledger close interval on Stellar
/// mainnet.
pub const MIN_DEADLINE_OFFSET: u64 = 60;

/// Maximum basis-point value representing 100 % progress (goal fully met).
///
/// Progress is capped at this value so callers always receive a value in
/// `[0, MAX_PROGRESS_BPS]` regardless of how much the goal was exceeded.
pub const MAX_PROGRESS_BPS: u32 = 10_000;

// ── Validation helpers ───────────────────────────────────────────────────────

/// Validates that `goal` meets the minimum threshold.
///
/// @param  goal  The proposed campaign goal in token units.
/// @return       `Ok(())` if valid, `Err(&'static str)` with a reason otherwise.
///
/// @dev    Returns a `&'static str` rather than `ContractError` so this module
///         stays free of the contract's error type and can be used in off-chain
///         tooling without pulling in the full contract dependency.
#[inline]
pub fn validate_goal(goal: i128) -> Result<(), &'static str> {
    if goal < MIN_GOAL_AMOUNT {
        return Err("goal must be at least MIN_GOAL_AMOUNT");
    }
    Ok(())
}

/// Validates that `min_contribution` meets the minimum floor.
///
/// @param  min_contribution  The proposed minimum contribution in token units.
/// @return                   `Ok(())` if valid, `Err` otherwise.
#[inline]
pub fn validate_min_contribution(min_contribution: i128) -> Result<(), &'static str> {
    if min_contribution < MIN_CONTRIBUTION_AMOUNT {
        return Err("min_contribution must be at least MIN_CONTRIBUTION_AMOUNT");
    }
    Ok(())
}

/// Validates that the campaign deadline is sufficiently far in the future.
///
/// @param  now       Current ledger timestamp (seconds since Unix epoch).
/// @param  deadline  Proposed campaign deadline timestamp.
/// @return           `Ok(())` if `deadline >= now + MIN_DEADLINE_OFFSET`.
#[inline]
pub fn validate_deadline(now: u64, deadline: u64) -> Result<(), &'static str> {
    if deadline < now.saturating_add(MIN_DEADLINE_OFFSET) {
        return Err("deadline must be at least MIN_DEADLINE_OFFSET seconds in the future");
    }
    Ok(())
}

/// Validates that a platform fee does not exceed the maximum allowed.
///
/// @param  fee_bps  Platform fee in basis points.
/// @return          `Ok(())` if `fee_bps <= MAX_PLATFORM_FEE_BPS`.
#[inline]
pub fn validate_platform_fee(fee_bps: u32) -> Result<(), &'static str> {
    if fee_bps > MAX_PLATFORM_FEE_BPS {
        return Err("platform fee cannot exceed MAX_PLATFORM_FEE_BPS (100%)");
    }
    Ok(())
}

/// Computes campaign progress in basis points, capped at [`MAX_PROGRESS_BPS`].
///
/// @param  total_raised  Amount raised so far (token units).
/// @param  goal          Campaign goal (token units, must be > 0).
/// @return               Progress in bps in the range `[0, MAX_PROGRESS_BPS]`.
///
/// @dev    Returns 0 when `goal == 0` to avoid division by zero; callers
///         should ensure `goal >= MIN_GOAL_AMOUNT` before calling.
#[inline]
pub fn compute_progress_bps(total_raised: i128, goal: i128) -> u32 {
    if goal <= 0 {
        return 0;
    }
    let raw = (total_raised * PROGRESS_BPS_SCALE) / goal;
    if raw > PROGRESS_BPS_SCALE {
        MAX_PROGRESS_BPS
    } else {
        raw as u32
    }
}
