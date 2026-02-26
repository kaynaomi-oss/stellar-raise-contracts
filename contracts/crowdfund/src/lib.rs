#![no_std]
#![allow(missing_docs)]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Env, String, Symbol, Vec,
};

#[cfg(test)]
mod test;

// ── Version ─────────────────────────────────────────────────────────────────

/// Contract version constant.
///
/// This constant must be manually incremented with every contract upgrade
/// (see Issue #38). External tools use this to detect logic changes at a
/// given contract address.
const CONTRACT_VERSION: u32 = 2;

// ── Data Types ──────────────────────────────────────────────────────────────

/// Represents the campaign status.
#[derive(Clone, PartialEq)]
#[contracttype]
pub enum Status {
    /// The campaign is currently active and accepting contributions.
    Active,
    /// The campaign was successful and goal was met.
    Successful,
    /// The campaign was refunded because goal was not met.
    Refunded,
    /// The campaign was cancelled by the creator.
    Cancelled,
}

/// Campaign statistics for the get_stats view.
#[derive(Clone)]
#[contracttype]
pub struct RoadmapItem {
    pub date: u64,
    pub description: String,
}

/// Platform configuration for fee handling.
#[derive(Clone)]
#[contracttype]
pub struct PlatformConfig {
    pub address: Address,
    pub fee_bps: u32,
}

/// A reward tier with a name and minimum contribution amount to qualify.
#[derive(Clone)]
#[contracttype]
pub struct RewardTier {
    pub name: String,
    pub min_amount: i128,
}

/// Represents all storage keys used by the crowdfund contract.
#[derive(Clone)]
#[contracttype]
pub struct Contribution {
    pub amount: i128,
    pub is_early_bird: bool,
}

#[derive(Clone)]
#[contracttype]
pub struct CampaignStats {
    /// Total amount raised so far.
    pub total_raised: i128,
    /// The funding goal.
    pub goal: i128,
    /// Progress towards goal in basis points (10000 = 100%).
    pub progress_bps: u32,
    /// Number of contributors.
    pub contributor_count: u32,
    /// Average contribution amount.
    pub average_contribution: i128,
    /// Largest contribution amount.
    pub largest_contribution: i128,
}

/// Represents all storage keys used by the crowdfund contract.
#[derive(Clone)]
#[contracttype]
pub struct CampaignInfo {
    pub creator: Address,
    pub token: Address,
    pub goal: i128,
    pub deadline: u64,
    pub total_raised: i128,
    pub title: String,
    pub description: String,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// Whether the campaign is paused.
    Paused,
    /// The hard cap for the campaign.
    HardCap,
    /// The campaign category.
    Category,
    /// The campaign tags.
    Tags,
    /// The address of the campaign creator.
    Creator,
    /// The token used for contributions (e.g. USDC).
    Token,
    /// The funding goal in the token's smallest unit.
    Goal,
    /// The deadline as a ledger timestamp.
    Deadline,
    /// Total amount raised so far.
    TotalRaised,
    /// Individual contribution by address.
    Contribution(Address),
    /// List of all contributor addresses.
    Contributors,
    /// Campaign status (Active, Successful, Refunded).
    Status,
    /// Minimum contribution amount.
    MinContribution,
    /// List of roadmap items with dates and descriptions.
    Roadmap,
    /// The address authorized to upgrade the contract.
    Admin,
    /// Campaign title.
    Title,
    /// Last contribution timestamp per address (for rate limiting).
    LastContributionTime(Address),
    /// Campaign description.
    Description,
    /// Campaign social links.
    SocialLinks,
    /// Platform configuration for fee handling.
    PlatformConfig,
    /// List of reward tiers (name + min_amount).
    RewardTiers,
    /// Individual pledge by address.
    Pledge(Address),
    /// List of all pledger addresses.
    Pledgers,
    /// Total amount pledged (not yet collected).
    TotalPledged,
    /// List of stretch goal milestones.
    StretchGoals,
    /// Campaign updates blog: Vec<(u64, String)> of (timestamp, update text).
    Updates,
    /// Whether whitelist is enabled for this campaign.
    WhitelistEnabled,
    /// Individual whitelist entry by address.
    Whitelist(Address),
}

// ── Rate Limiting ──────────────────────────────────────────────────────────
/// Minimum seconds required between contributions from the same address.
const CONTRIBUTION_COOLDOWN: u64 = 5;

// ── Contract Error ──────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    CampaignEnded = 2,
    CampaignStillActive = 3,
    GoalNotReached = 4,
    GoalReached = 5,
    Overflow = 6,
    InvalidHardCap = 7,
    HardCapExceeded = 8,
    RateLimitExceeded = 9,
    ContractPaused = 10,
}

// ── Contract ────────────────────────────────────────────────────────────────

/// The main crowdfund contract implementation.
#[contract]
pub struct CrowdfundContract;

#[contractimpl]
impl CrowdfundContract {
    // ── Multisig & DAO Compatibility ───────────────────────────────────────
    //
    // IMPORTANT: This contract fully supports multi-signature wallets and DAO
    // contracts as the campaign creator. The Soroban `Address` type can represent
    // both standard user accounts and contract addresses.
    //
    // When `creator.require_auth()` is called:
    // - For user accounts: Standard signature verification is performed
    // - For contract addresses: The contract's authorization logic is invoked,
    //   allowing multisig wallets, DAO governance contracts, or any custom
    //   authorization scheme to control the campaign
    //
    // All creator-restricted functions (withdraw, set_paused, update_metadata,
    // add_roadmap_item, add_stretch_goal, add_reward_tier, update_deadline,
    // post_update, add_to_whitelist) work seamlessly with multisig creators.
    //
    // Security Benefits:
    // - Eliminates single point of failure for high-value campaigns
    // - Enables decentralized governance of campaign operations
    // - Supports time-locked or threshold-based authorization schemes
    //
    // Example Multisig Patterns:
    // 1. M-of-N Threshold: Require M signatures out of N authorized signers
    // 2. DAO Governance: Require on-chain voting approval for admin actions
    // 3. Time-locked Admin: Require time delay before executing sensitive operations
    // 4. Hierarchical Control: Different authorization levels for different operations
    //
    // ───────────────────────────────────────────────────────────────────────

    /// Helper function to check if the creator address is a contract.
    ///
    /// This is useful for distinguishing between standard user accounts and
    /// contract-based creators (multisig wallets, DAOs, etc.) for logging,
    /// analytics, or conditional logic.
    ///
    /// # Arguments
    /// * `env` – The contract environment
    /// * `creator` – The address to check
    ///
    /// # Returns
    /// * `true` if the address is a contract, `false` if it's a user account
    ///
    /// # Note
    /// This function does not affect authorization - `require_auth()` works
    /// correctly for both user accounts and contracts. This is purely for
    /// informational purposes.
    ///
    /// # Implementation Note
    /// In Soroban, the Address type abstracts over both account and contract
    /// addresses. While there's no direct API to check the address type at
    /// runtime, the authorization mechanism (`require_auth()`) handles both
    /// cases transparently. This helper is provided for documentation purposes
    /// and potential future use cases where distinguishing address types is needed.
    #[allow(dead_code)]
    fn is_contract_creator(_env: &Env, _creator: &Address) -> bool {
        // Note: Soroban's Address type doesn't expose a direct method to check
        // if an address is a contract vs. an account at runtime. However, this
        // doesn't matter for authorization - require_auth() works correctly for
        // both types.
        //
        // For actual runtime checks, you would need to:
        // 1. Attempt to invoke a known contract function (will fail for accounts)
        // 2. Use external indexing/metadata to track contract addresses
        // 3. Rely on off-chain knowledge of the creator type
        //
        // Since authorization works transparently for both types, this function
        // is primarily for documentation and potential future enhancements.
        false // Placeholder - actual implementation would require additional context
    }

    /// Initializes a new crowdfunding campaign.
    ///
    /// # Arguments
    /// * `creator`            – The campaign creator's address (can be a user account,
    ///                          multisig wallet, or DAO contract).
    /// * `token`              – The token contract address used for contributions.
    /// * `goal`               – The funding goal (in the token's smallest unit).
    /// * `hard_cap`           – Maximum total amount that can be raised (must be >= goal).
    /// * `deadline`           – The campaign deadline as a ledger timestamp.
    /// * `min_contribution`   – The minimum contribution amount.
    /// * `title`              – The campaign title.
    /// * `description`        – The campaign description.
    /// * `platform_config`    – Optional platform configuration (address and fee in basis points).
    ///
    /// # Multisig Support
    /// The `creator` parameter can be any valid Soroban address, including:
    /// - Standard user accounts (ed25519 public keys)
    /// - Multisig wallet contracts (requiring M-of-N signatures)
    /// - DAO governance contracts (requiring on-chain voting)
    /// - Custom authorization contracts (time-locks, hierarchical permissions, etc.)
    ///
    /// The `creator.require_auth()` call ensures that only the authorized entity
    /// (whether a single user or a multisig group) can initialize the campaign.
    ///
    /// # Panics
    /// * If already initialized.
    /// * If platform fee exceeds 10,000 (100%).
    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        env: Env,
        creator: Address,
        token: Address,
        goal: i128,
        _hard_cap: i128,
        deadline: u64,
        min_contribution: i128,
        title: String,
        description: String,
        platform_config: Option<PlatformConfig>,
    ) -> Result<(), ContractError> {
        // Prevent re-initialization.
        if env.storage().instance().has(&DataKey::Creator) {
            return Err(ContractError::AlreadyInitialized);
        }

        creator.require_auth();

        // Validate platform fee if provided.
        if let Some(ref config) = platform_config {
            if config.fee_bps > 10_000 {
                panic!("platform fee cannot exceed 100%");
            }
        }

        env.storage().instance().set(&DataKey::Creator, &creator);
        env.storage().instance().set(&DataKey::Token, &token);

        env.storage().instance().set(&DataKey::Goal, &goal);
        env.storage().instance().set(&DataKey::Deadline, &deadline);
        env.storage()
            .instance()
            .set(&DataKey::MinContribution, &min_contribution);
        env.storage().instance().set(&DataKey::Title, &title);
        env.storage()
            .instance()
            .set(&DataKey::Description, &description);
        env.storage().instance().set(&DataKey::TotalRaised, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::Status, &Status::Active);

        let empty_contributors: Vec<Address> = Vec::new(&env);
        env.storage()
            .persistent()
            .set(&DataKey::Contributors, &empty_contributors);

        let empty_roadmap: Vec<RoadmapItem> = Vec::new(&env);
        env.storage()
            .instance()
            .set(&DataKey::Roadmap, &empty_roadmap);

        let empty_reward_tiers: Vec<RewardTier> = Vec::new(&env);
        env.storage()
            .instance()
            .set(&DataKey::RewardTiers, &empty_reward_tiers);

        Ok(())
    }

    /// Adds addresses to the campaign's whitelist.
    ///
    /// This function is restricted to the campaign creator and can only be
    /// called while the campaign is Active.
    pub fn add_to_whitelist(env: Env, addresses: Vec<Address>) {
        if addresses.is_empty() {
            panic!("addresses list must not be empty");
        }

        let status: Status = env.storage().instance().get(&DataKey::Status).unwrap();
        if status != Status::Active {
            panic!("campaign is not active");
        }

        let creator: Address = env.storage().instance().get(&DataKey::Creator).unwrap();
        creator.require_auth();

        if !env.storage().instance().has(&DataKey::WhitelistEnabled) {
            env.storage()
                .instance()
                .set(&DataKey::WhitelistEnabled, &true);
        }

        for address in addresses.iter() {
            env.storage()
                .instance()
                .set(&DataKey::Whitelist(address), &true);
        }
    }

    /// Contribute tokens to the campaign.
    ///
    /// The contributor must authorize the call. Contributions are rejected
    /// after the deadline has passed.
    pub fn contribute(env: Env, contributor: Address, amount: i128) -> Result<(), ContractError> {
        // ── Rate limiting: enforce cooldown between contributions ──
        let now = env.ledger().timestamp();
        let last_time_key = DataKey::LastContributionTime(contributor.clone());
        if let Some(last_time) = env.storage().persistent().get::<_, u64>(&last_time_key) {
            if now < last_time + CONTRIBUTION_COOLDOWN {
                return Err(ContractError::RateLimitExceeded);
            }
        }

        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            return Err(ContractError::ContractPaused);
        }

        contributor.require_auth();

        let min_contribution: i128 = env
            .storage()
            .instance()
            .get(&DataKey::MinContribution)
            .unwrap();
        if amount < min_contribution {
            panic!("amount below minimum");
        }

        let deadline: u64 = env.storage().instance().get(&DataKey::Deadline).unwrap();
        if env.ledger().timestamp() > deadline {
            return Err(ContractError::CampaignEnded);
        }

        let total: i128 = env.storage().instance().get(&DataKey::TotalRaised).unwrap();
        let hard_cap: i128 = env.storage().instance().get(&DataKey::HardCap).unwrap();

        if total >= hard_cap {
            return Err(ContractError::HardCapExceeded);
        }

        let headroom = hard_cap - total;
        let effective_amount = if amount <= headroom { amount } else { headroom };

        let token_address: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_address);

        // Transfer tokens from the contributor to this contract.
        token_client.transfer(
            &contributor,
            &env.current_contract_address(),
            &effective_amount,
        );

        // Update the contributor's running total with overflow protection.
        let contribution_key = DataKey::Contribution(contributor.clone());
        let prev: i128 = env
            .storage()
            .persistent()
            .get(&contribution_key)
            .unwrap_or(0);

        let new_contribution = prev
            .checked_add(effective_amount)
            .ok_or(ContractError::Overflow)?;

        env.storage()
            .persistent()
            .set(&contribution_key, &new_contribution);
        env.storage()
            .persistent()
            .extend_ttl(&contribution_key, 100, 100);

        // Update the global total raised with overflow protection.
        let new_total = total
            .checked_add(effective_amount)
            .ok_or(ContractError::Overflow)?;

        env.storage()
            .instance()
            .set(&DataKey::TotalRaised, &new_total);

        if new_total == hard_cap {
            env.events()
                .publish(("campaign", "hard_cap_reached"), hard_cap);
        }

        // Track contributor address if new.
        let mut contributors: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Contributors)
            .unwrap();
        if !contributors.contains(&contributor) {
            contributors.push_back(contributor.clone());
            env.storage()
                .persistent()
                .set(&DataKey::Contributors, &contributors);
            env.storage()
                .persistent()
                .extend_ttl(&DataKey::Contributors, 100, 100);
        }

        // Emit contribution event
        env.events()
            .publish(("campaign", "contributed"), (contributor, effective_amount));

        // Update last contribution time for rate limiting
        env.storage().persistent().set(&last_time_key, &now);
        env.storage()
            .persistent()
            .extend_ttl(&last_time_key, 100, 100);

        Ok(())
    }

    /// Pledge tokens to the campaign without transferring them immediately.
    ///
    /// The pledger must authorize the call. Pledges are recorded off-chain
    /// and only collected if the goal is met after the deadline.
    pub fn pledge(env: Env, pledger: Address, amount: i128) -> Result<(), ContractError> {
        pledger.require_auth();

        let min_contribution: i128 = env
            .storage()
            .instance()
            .get(&DataKey::MinContribution)
            .unwrap();
        if amount < min_contribution {
            panic!("amount below minimum");
        }

        let deadline: u64 = env.storage().instance().get(&DataKey::Deadline).unwrap();
        if env.ledger().timestamp() > deadline {
            return Err(ContractError::CampaignEnded);
        }

        // Update the pledger's running total.
        let pledge_key = DataKey::Pledge(pledger.clone());
        let prev: i128 = env.storage().persistent().get(&pledge_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&pledge_key, &(prev + amount));
        env.storage().persistent().extend_ttl(&pledge_key, 100, 100);

        // Update the global total pledged.
        let total_pledged: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalPledged)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalPledged, &(total_pledged + amount));

        // Track pledger address if new.
        let mut pledgers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Pledgers)
            .unwrap_or_else(|| Vec::new(&env));
        if !pledgers.contains(&pledger) {
            pledgers.push_back(pledger.clone());
            env.storage()
                .persistent()
                .set(&DataKey::Pledgers, &pledgers);
            env.storage()
                .persistent()
                .extend_ttl(&DataKey::Pledgers, 100, 100);
        }

        // Emit pledge event
        env.events()
            .publish(("campaign", "pledged"), (pledger, amount));

        Ok(())
    }

    /// Collect all pledges after the deadline when the goal is met.
    ///
    /// This function transfers tokens from all pledgers to the contract.
    /// Only callable after the deadline and when the combined total of
    /// contributions and pledges meets or exceeds the goal.
    pub fn collect_pledges(env: Env) -> Result<(), ContractError> {
        let status: Status = env.storage().instance().get(&DataKey::Status).unwrap();
        if status != Status::Active {
            panic!("campaign is not active");
        }

        let deadline: u64 = env.storage().instance().get(&DataKey::Deadline).unwrap();
        if env.ledger().timestamp() <= deadline {
            return Err(ContractError::CampaignStillActive);
        }

        let goal: i128 = env.storage().instance().get(&DataKey::Goal).unwrap();
        let total_raised: i128 = env.storage().instance().get(&DataKey::TotalRaised).unwrap();
        let total_pledged: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalPledged)
            .unwrap_or(0);

        // Check if combined total meets the goal
        if total_raised + total_pledged < goal {
            return Err(ContractError::GoalNotReached);
        }

        let token_address: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_address);

        let pledgers: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Pledgers)
            .unwrap_or_else(|| Vec::new(&env));

        // Collect pledges from all pledgers
        for pledger in pledgers.iter() {
            let pledge_key = DataKey::Pledge(pledger.clone());
            let amount: i128 = env.storage().persistent().get(&pledge_key).unwrap_or(0);
            if amount > 0 {
                // Transfer tokens from pledger to contract
                token_client.transfer(&pledger, &env.current_contract_address(), &amount);

                // Clear the pledge
                env.storage().persistent().set(&pledge_key, &0i128);
                env.storage().persistent().extend_ttl(&pledge_key, 100, 100);
            }
        }

        // Update total raised to include collected pledges
        env.storage()
            .instance()
            .set(&DataKey::TotalRaised, &(total_raised + total_pledged));

        // Reset total pledged
        env.storage().instance().set(&DataKey::TotalPledged, &0i128);

        // Emit pledges collected event
        env.events()
            .publish(("campaign", "pledges_collected"), total_pledged);

        Ok(())
    }

    /// Withdraw a specific amount from the contributor's balance.
    ///
    /// Callable by the contributor only while the campaign is still active and
    /// before the deadline.
    pub fn withdraw_contribution(env: Env, contributor: Address, amount: i128) {
        contributor.require_auth();

        let status: Status = env.storage().instance().get(&DataKey::Status).unwrap();
        if status != Status::Active {
            panic!("campaign is not active");
        }

        let deadline: u64 = env.storage().instance().get(&DataKey::Deadline).unwrap();
        if env.ledger().timestamp() > deadline {
            panic!("campaign has ended");
        }

        let prev: i128 = env
            .storage()
            .instance()
            .get(&DataKey::Contribution(contributor.clone()))
            .unwrap_or(0);

        if amount > prev {
            panic!("insufficient balance");
        }

        let token_address: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_address);

        // Transfer tokens back to the contributor.
        token_client.transfer(&env.current_contract_address(), &contributor, &amount);

        // Update contributor balance.
        let new_balance = prev - amount;
        if new_balance == 0 {
            env.storage()
                .instance()
                .remove(&DataKey::Contribution(contributor.clone()));

            // Remove from contributors list.
            let mut contributors: Vec<Address> = env
                .storage()
                .instance()
                .get(&DataKey::Contributors)
                .unwrap();
            let mut index = 0;
            let mut found = false;
            for c in contributors.iter() {
                if c == contributor {
                    found = true;
                    break;
                }
                index += 1;
            }
            if found {
                contributors.remove(index);
                env.storage()
                    .instance()
                    .set(&DataKey::Contributors, &contributors);
            }
        } else {
            env.storage()
                .instance()
                .set(&DataKey::Contribution(contributor.clone()), &new_balance);
        }

        // Update global total raised.
        let total: i128 = env.storage().instance().get(&DataKey::TotalRaised).unwrap();
        env.storage()
            .instance()
            .set(&DataKey::TotalRaised, &(total - amount));
    }

    /// Withdraw raised funds — only callable by the creator after the
    /// deadline, and only if the goal has been met.
    ///
    /// If a platform fee is configured, deducts the fee and transfers it to
    /// the platform address, then sends the remainder to the creator.
    ///
    /// # Multisig Support
    /// This function fully supports multisig and DAO creators. When the creator
    /// is a contract address, `creator.require_auth()` will invoke the contract's
    /// authorization logic, enabling:
    /// - M-of-N threshold signatures for withdrawal approval
    /// - DAO governance voting before fund withdrawal
    /// - Time-locked withdrawals for added security
    /// - Any custom authorization scheme implemented by the creator contract
    ///
    /// # Security Note
    /// For high-value campaigns, using a multisig or DAO as the creator significantly
    /// reduces the risk of unauthorized fund withdrawal, as multiple parties must
    /// approve the transaction.
    pub fn withdraw(env: Env) -> Result<(), ContractError> {
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            return Err(ContractError::ContractPaused);
        }

        let status: Status = env.storage().instance().get(&DataKey::Status).unwrap();
        if status != Status::Active {
            panic!("campaign is not active");
        }

        let creator: Address = env.storage().instance().get(&DataKey::Creator).unwrap();
        creator.require_auth();

        let deadline: u64 = env.storage().instance().get(&DataKey::Deadline).unwrap();
        if env.ledger().timestamp() <= deadline {
            return Err(ContractError::CampaignStillActive);
        }

        let goal: i128 = env.storage().instance().get(&DataKey::Goal).unwrap();
        let total: i128 = env.storage().instance().get(&DataKey::TotalRaised).unwrap();
        if total < goal {
            return Err(ContractError::GoalNotReached);
        }

        let token_address: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_address);

        // Calculate and transfer platform fee if configured.
        let platform_config: Option<PlatformConfig> =
            env.storage().instance().get(&DataKey::PlatformConfig);

        let creator_payout = if let Some(config) = platform_config {
            // Calculate fee using checked arithmetic to prevent overflow.
            let fee = total
                .checked_mul(config.fee_bps as i128)
                .expect("fee calculation overflow")
                .checked_div(10_000)
                .expect("fee division by zero");

            // Transfer fee to platform.
            token_client.transfer(&env.current_contract_address(), &config.address, &fee);

            // Emit event with fee details.
            env.events()
                .publish(("campaign", "fee_transferred"), (&config.address, fee));

            // Calculate creator payout.
            total.checked_sub(fee).expect("creator payout underflow")
        } else {
            total
        };

        // Transfer remainder to creator.
        token_client.transfer(&env.current_contract_address(), &creator, &creator_payout);

        env.storage().instance().set(&DataKey::TotalRaised, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::Status, &Status::Successful);

        // Emit withdrawal event
        env.events()
            .publish(("campaign", "withdrawn"), (creator.clone(), total));

        Ok(())
    }

    /// Refund a single contributor — pull-based model.
    ///
    /// This function implements a **pull-based** refund pattern where each
    /// contributor must individually claim their refund. This is more scalable
    /// than the previous push-based batch refund as it avoids hitting resource
    /// limits when there are thousands of backers.
    ///
    /// # Pull-based Refund Model
    ///
    /// Instead of iterating over all contributors in a single transaction
    /// (which would fail with thousands of backers due to resource limits),
    /// each contributor must claim their own refund individually by calling
    /// this function with their address.
    ///
    /// # Arguments
    /// * `contributor` – The address of the contributor requesting a refund.
    ///
    /// # Requirements
    /// * The campaign status must be Active.
    /// * The deadline must have passed.
    /// * The funding goal must not have been reached.
    /// * The contributor must have an existing contribution.
    ///
    /// # Returns
    /// Ok(()) if successful, or an error if the campaign is not eligible for
    /// refunds.
    ///
    /// # Example
    /// ```bash
    /// stellar contract invoke \
    ///   --id <CONTRACT_ID> \
    ///   --network testnet \
    ///   --source <YOUR_SECRET_KEY> \
    ///   -- refund_single \
    ///   --contributor <YOUR_ADDRESS>
    /// ```
    pub fn refund_single(env: Env, contributor: Address) -> Result<(), ContractError> {
        // Require contributor authorization.
        contributor.require_auth();

        // Check campaign status is Active.
        let status: Status = env.storage().instance().get(&DataKey::Status).unwrap();
        if status != Status::Active {
            panic!("campaign is not active");
        }

        // Check deadline has passed.
        let deadline: u64 = env.storage().instance().get(&DataKey::Deadline).unwrap();
        if env.ledger().timestamp() <= deadline {
            return Err(ContractError::CampaignStillActive);
        }

        // Check goal was not reached.
        let goal: i128 = env.storage().instance().get(&DataKey::Goal).unwrap();
        let total: i128 = env.storage().instance().get(&DataKey::TotalRaised).unwrap();
        if total >= goal {
            return Err(ContractError::GoalReached);
        }

        // Get the contributor's contribution amount.
        let contribution_key = DataKey::Contribution(contributor.clone());
        let amount: i128 = env
            .storage()
            .persistent()
            .get(&contribution_key)
            .unwrap_or(0);

        // Skip if no contribution to refund.
        if amount == 0 {
            return Ok(());
        }

        // Transfer tokens back to the contributor.
        let token_address: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &contributor, &amount);

        // Reset the contributor's contribution to 0.
        env.storage().persistent().set(&contribution_key, &0i128);
        env.storage()
            .persistent()
            .extend_ttl(&contribution_key, 100, 100);

        // Update total raised.
        let new_total = total - amount;
        env.storage()
            .instance()
            .set(&DataKey::TotalRaised, &new_total);

        // Emit refund event
        env.events()
            .publish(("campaign", "refunded"), (contributor.clone(), amount));

        Ok(())
    }

    /// Upgrade the contract to a new WASM implementation — admin-only.
    ///
    /// This function allows the designated admin to upgrade the contract's WASM code
    /// without changing the contract's address or storage. The new WASM hash must be
    /// provided and the caller must be authorized as the admin.
    ///
    /// # Arguments
    /// * `new_wasm_hash` – The SHA-256 hash of the new WASM binary to deploy.
    ///
    /// # Panics
    /// * If the caller is not the admin.
    pub fn upgrade(env: Env, new_wasm_hash: soroban_sdk::BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    /// Pause or unpause the contract — creator-only.
    ///
    /// When paused, all contributions, withdrawals, and refunds are blocked.
    /// This is a security mechanism to halt operations in case of detected
    /// vulnerabilities or external threats.
    ///
    /// # Arguments
    /// * `paused` – True to pause, false to unpause.
    ///
    /// # Multisig Support
    /// This critical security function works seamlessly with multisig creators.
    /// When the creator is a multisig contract, pausing/unpausing requires
    /// approval from the multisig signers, preventing any single party from
    /// unilaterally halting the campaign. This is especially important for
    /// high-value campaigns where pause decisions should be collective.
    pub fn set_paused(env: Env, paused: bool) {
        let creator: Address = env.storage().instance().get(&DataKey::Creator).unwrap();
        creator.require_auth();

        env.storage().instance().set(&DataKey::Paused, &paused);

        let event_name = if paused { "paused" } else { "unpaused" };
        env.events().publish(("campaign", event_name), ());
    }

    /// Update campaign metadata — only callable by the creator while the
    /// campaign is still Active.
    ///
    /// # Arguments
    /// * `creator`     – The campaign creator's address (for authentication).
    /// * `title`       – Optional new title (None to keep existing).
    /// * `description` – Optional new description (None to keep existing).
    /// * `socials`    – Optional new social links (None to keep existing).
    ///
    /// # Multisig Support
    /// Metadata updates support multisig creators, ensuring that campaign
    /// information changes require collective approval when using a multisig
    /// or DAO creator. This prevents unauthorized modification of campaign
    /// details and maintains transparency.
    pub fn update_metadata(
        env: Env,
        creator: Address,
        title: Option<String>,
        description: Option<String>,
        socials: Option<String>,
    ) {
        // Check campaign is active.
        let status: Status = env.storage().instance().get(&DataKey::Status).unwrap();
        if status != Status::Active {
            panic!("campaign is not active");
        }

        // Require creator authentication and verify caller is the creator.
        let stored_creator: Address = env.storage().instance().get(&DataKey::Creator).unwrap();
        if creator != stored_creator {
            panic!("not authorized");
        }
        creator.require_auth();

        // Track which fields were updated for the event.
        let mut updated_fields: Vec<Symbol> = Vec::new(&env);

        // Update title if provided.
        if let Some(new_title) = title {
            env.storage().instance().set(&DataKey::Title, &new_title);
            updated_fields.push_back(Symbol::new(&env, "title"));
        }

        // Update description if provided.
        if let Some(new_description) = description {
            env.storage()
                .instance()
                .set(&DataKey::Description, &new_description);
            updated_fields.push_back(Symbol::new(&env, "description"));
        }

        // Update social links if provided.
        if let Some(new_socials) = socials {
            env.storage()
                .instance()
                .set(&DataKey::SocialLinks, &new_socials);
            updated_fields.push_back(Symbol::new(&env, "socials"));
        }

        // Emit metadata_updated event with the list of updated field names.
        env.events().publish(
            (
                Symbol::new(&env, "campaign"),
                Symbol::new(&env, "metadata_updated"),
            ),
            updated_fields,
        );
    }

    /// Update the campaign deadline — only callable by the creator while the
    /// campaign is still Active.
    ///
    /// # Arguments
    /// * `new_deadline` – The new deadline as a ledger timestamp (must be greater than current deadline).
    ///
    /// # Panics
    /// * If the campaign is not Active.
    /// * If new_deadline is less than or equal to the current deadline.
    pub fn update_deadline(env: Env, new_deadline: u64) {
        // Check campaign is active.
        let status: Status = env.storage().instance().get(&DataKey::Status).unwrap();
        if status != Status::Active {
            panic!("campaign is not active");
        }

        // Require creator authentication.
        let creator: Address = env.storage().instance().get(&DataKey::Creator).unwrap();
        creator.require_auth();

        // Get the current deadline.
        let current_deadline: u64 = env.storage().instance().get(&DataKey::Deadline).unwrap();

        // Ensure new_deadline is greater than current_deadline (only extensions allowed).
        if new_deadline <= current_deadline {
            panic!("new deadline must be after current deadline");
        }

        // Update the deadline.
        env.storage()
            .instance()
            .set(&DataKey::Deadline, &new_deadline);

        // Emit deadline_updated event with old and new deadline values.
        env.events().publish(
            ("campaign", "deadline_updated"),
            (current_deadline, new_deadline),
        );
    }

    // ── View helpers ────────────────────────────────────────────────────

    /// Add a roadmap item to the campaign timeline.
    ///
    /// Only the creator can add roadmap items. The date must be in the future
    /// and the description must not be empty.
    pub fn add_roadmap_item(env: Env, date: u64, description: String) {
        let creator: Address = env.storage().instance().get(&DataKey::Creator).unwrap();
        creator.require_auth();

        let current_timestamp = env.ledger().timestamp();
        if date <= current_timestamp {
            panic!("date must be in the future");
        }

        if description.is_empty() {
            panic!("description cannot be empty");
        }

        let mut roadmap: Vec<RoadmapItem> = env
            .storage()
            .instance()
            .get(&DataKey::Roadmap)
            .unwrap_or_else(|| Vec::new(&env));

        let item = RoadmapItem {
            date,
            description: description.clone(),
        };

        roadmap.push_back(item.clone());
        env.storage().instance().set(&DataKey::Roadmap, &roadmap);

        env.events()
            .publish(("campaign", "roadmap_item_added"), (date, description));
    }

    /// Returns the full ordered list of roadmap items.
    pub fn roadmap(env: Env) -> Vec<RoadmapItem> {
        env.storage()
            .instance()
            .get(&DataKey::Roadmap)
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Post a campaign update (creator only).
    ///
    /// Records the current timestamp and the provided text. Rejects empty text.
    /// Emits a (campaign, update_posted) event with timestamp and text.
    pub fn post_update(env: Env, text: String) {
        let creator: Address = env.storage().instance().get(&DataKey::Creator).unwrap();
        creator.require_auth();

        if text.is_empty() {
            panic!("update text cannot be empty");
        }

        let timestamp = env.ledger().timestamp();

        let mut updates: Vec<(u64, String)> = env
            .storage()
            .instance()
            .get(&DataKey::Updates)
            .unwrap_or_else(|| Vec::new(&env));

        updates.push_back((timestamp, text.clone()));

        env.storage().instance().set(&DataKey::Updates, &updates);
        env.events()
            .publish(("campaign", "update_posted"), (timestamp, text));
    }

    /// Returns the full ordered list of campaign updates.
    ///
    /// Each entry is a tuple of (timestamp, update text) in chronological order.
    pub fn get_updates(env: Env) -> Vec<(u64, String)> {
        env.storage()
            .instance()
            .get(&DataKey::Updates)
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Add a stretch goal milestone to the campaign.
    ///
    /// Only the creator can add stretch goals. The milestone must be greater
    /// than the primary goal.
    pub fn add_stretch_goal(env: Env, milestone: i128) {
        let creator: Address = env.storage().instance().get(&DataKey::Creator).unwrap();
        creator.require_auth();

        let goal: i128 = env.storage().instance().get(&DataKey::Goal).unwrap();
        if milestone <= goal {
            panic!("stretch goal must be greater than primary goal");
        }

        let mut stretch_goals: Vec<i128> = env
            .storage()
            .instance()
            .get(&DataKey::StretchGoals)
            .unwrap_or_else(|| Vec::new(&env));

        stretch_goals.push_back(milestone);
        env.storage()
            .instance()
            .set(&DataKey::StretchGoals, &stretch_goals);
    }

    /// Add a reward tier (creator only). Rejects min_amount <= 0.
    pub fn add_reward_tier(env: Env, creator: Address, name: String, min_amount: i128) {
        let status: Status = env.storage().instance().get(&DataKey::Status).unwrap();
        if status != Status::Active {
            panic!("campaign is not active");
        }

        let stored_creator: Address = env.storage().instance().get(&DataKey::Creator).unwrap();
        if creator != stored_creator {
            panic!("not authorized");
        }
        creator.require_auth();

        if min_amount <= 0 {
            panic!("min_amount must be greater than 0");
        }

        let mut tiers: Vec<RewardTier> = env
            .storage()
            .instance()
            .get(&DataKey::RewardTiers)
            .unwrap_or_else(|| Vec::new(&env));

        tiers.push_back(RewardTier {
            name: name.clone(),
            min_amount,
        });
        env.storage().instance().set(&DataKey::RewardTiers, &tiers);

        env.events()
            .publish(("campaign", "reward_tier_added"), (name, min_amount));
    }

    /// Returns the full ordered list of reward tiers.
    pub fn reward_tiers(env: Env) -> Vec<RewardTier> {
        env.storage()
            .instance()
            .get(&DataKey::RewardTiers)
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Returns the highest tier name the user's contribution qualifies for,
    /// or None if the user has not contributed or no tiers are defined.
    /// Tiers are evaluated by min_amount descending (highest qualifying tier wins).
    pub fn get_user_tier(env: Env, user: Address) -> Option<String> {
        let contribution: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Contribution(user))
            .unwrap_or(0);

        if contribution <= 0 {
            return None;
        }

        let tiers: Vec<RewardTier> = env
            .storage()
            .instance()
            .get(&DataKey::RewardTiers)
            .unwrap_or_else(|| Vec::new(&env));

        if tiers.is_empty() {
            return None;
        }

        let mut best: Option<RewardTier> = None;
        for tier in tiers.iter() {
            if contribution >= tier.min_amount {
                let is_better = match &best {
                    None => true,
                    Some(ref b) => tier.min_amount > b.min_amount,
                };
                if is_better {
                    best = Some(tier.clone());
                }
            }
        }

        best.map(|t| t.name)
    }

    /// Returns the next unmet stretch goal milestone.
    ///
    /// Returns 0 if there are no stretch goals or all have been met.
    pub fn current_milestone(env: Env) -> i128 {
        let total_raised: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalRaised)
            .unwrap_or(0);

        let stretch_goals: Vec<i128> = env
            .storage()
            .instance()
            .get(&DataKey::StretchGoals)
            .unwrap_or_else(|| Vec::new(&env));

        for milestone in stretch_goals.iter() {
            if total_raised < milestone {
                return milestone;
            }
        }

        0
    }
    pub fn total_raised(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalRaised)
            .unwrap_or(0)
    }

    /// Returns the funding goal.
    pub fn goal(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::Goal).unwrap()
    }

    /// Returns the hard cap (maximum total that can be raised).
    pub fn hard_cap(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::HardCap).unwrap()
    }

    /// Returns the campaign deadline.
    pub fn deadline(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::Deadline).unwrap()
    }

    /// Returns the contribution of a specific address.
    pub fn contribution(env: Env, contributor: Address) -> i128 {
        let contribution_key = DataKey::Contribution(contributor);
        env.storage()
            .persistent()
            .get(&contribution_key)
            .unwrap_or(0)
    }

    /// Returns the pledge of a specific address.
    pub fn pledge_amount(env: Env, pledger: Address) -> i128 {
        let pledge_key = DataKey::Pledge(pledger);
        env.storage().persistent().get(&pledge_key).unwrap_or(0)
    }

    /// Returns the total amount pledged (not yet transferred).
    pub fn total_pledged(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalPledged)
            .unwrap_or(0)
    }

    /// Returns the minimum contribution amount.
    pub fn min_contribution(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::MinContribution)
            .unwrap()
    }

    /// Returns the campaign creator's address.
    pub fn creator(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Creator).unwrap()
    }

    /// Returns complete campaign information in a single call.
    pub fn get_campaign_info(env: Env) -> CampaignInfo {
        let creator: Address = env.storage().instance().get(&DataKey::Creator).unwrap();
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let goal: i128 = env.storage().instance().get(&DataKey::Goal).unwrap();
        let deadline: u64 = env.storage().instance().get(&DataKey::Deadline).unwrap();
        let total_raised: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalRaised)
            .unwrap_or(0);
        let title: String = env
            .storage()
            .instance()
            .get(&DataKey::Title)
            .unwrap_or_else(|| String::from_str(&env, ""));
        let description: String = env
            .storage()
            .instance()
            .get(&DataKey::Description)
            .unwrap_or_else(|| String::from_str(&env, ""));

        CampaignInfo {
            creator,
            token,
            goal,
            deadline,
            total_raised,
            title,
            description,
        }
    }

    /// Returns true if the address is whitelisted.
    pub fn is_whitelisted(env: Env, address: Address) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Whitelist(address))
            .unwrap_or(false)
    }

    /// Returns comprehensive campaign statistics.
    pub fn get_stats(env: Env) -> CampaignStats {
        let total_raised: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalRaised)
            .unwrap_or(0);
        let goal: i128 = env.storage().instance().get(&DataKey::Goal).unwrap();
        let contributors: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::Contributors)
            .unwrap();

        let progress_bps = if goal > 0 {
            let raw = (total_raised * 10_000) / goal;
            if raw > 10_000 {
                10_000
            } else {
                raw as u32
            }
        } else {
            0
        };

        let contributor_count = contributors.len();
        let (average_contribution, largest_contribution) = if contributor_count == 0 {
            (0, 0)
        } else {
            let average = total_raised / contributor_count as i128;
            let mut largest = 0i128;
            for contributor in contributors.iter() {
                let amount: i128 = env
                    .storage()
                    .instance()
                    .get(&DataKey::Contribution(contributor))
                    .unwrap_or(0);
                if amount > largest {
                    largest = amount;
                }
            }
            (average, largest)
        };

        CampaignStats {
            total_raised,
            goal,
            progress_bps,
            contributor_count,
            average_contribution,
            largest_contribution,
        }
    }

    /// Returns the campaign title.
    pub fn title(env: Env) -> String {
        let empty = String::from_str(&env, "");
        env.storage()
            .instance()
            .get(&DataKey::Title)
            .unwrap_or(empty)
    }

    /// Returns the campaign description.
    pub fn description(env: Env) -> String {
        let empty = String::from_str(&env, "");
        env.storage()
            .instance()
            .get(&DataKey::Description)
            .unwrap_or(empty)
    }

    /// Returns the campaign social links.
    pub fn socials(env: Env) -> String {
        let empty = String::from_str(&env, "");
        env.storage()
            .instance()
            .get(&DataKey::SocialLinks)
            .unwrap_or(empty)
    }

    /// Returns the contract version.
    ///
    /// This view function allows external tools to detect which version of the
    /// contract logic is currently running at this address. The version must be
    /// manually incremented with every contract upgrade (see Issue #38).
    pub fn version(_env: Env) -> u32 {
        CONTRACT_VERSION
    }

    /// Returns the token contract address used for contributions.
    pub fn token(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Token).unwrap()
    }
}
