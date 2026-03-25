# contribute() Error Handling

## Overview

All error conditions in `contribute()` and `pledge()` are represented as typed
`ContractError` variants. Off-chain scripts receive a numeric error code from
the Soroban host and can use the helpers in `contribute_error_handling.rs` to
interpret them without embedding magic numbers.

---

## Error Reference

| Code | Variant         | Trigger                                          | Retryable |
|------|-----------------|--------------------------------------------------|-----------|
| 2    | `CampaignEnded` | `ledger.timestamp > deadline`                    | No        |
| 6    | `Overflow`      | `checked_add` would wrap on contribution totals  | No        |
| 9    | `AmountTooLow`  | `amount < min_contribution`                      | No        |

> **Note on code 9**: Prior to this refactor, an amount below the minimum
> triggered `panic!("amount below minimum")`, which was indistinguishable from
> other host panics by off-chain scripts. It is now a typed `ContractError::AmountTooLow`
> (code 9) returned via `Err(...)`, enabling precise error handling.

---

## Security Assumptions

| Assumption | Detail |
|---|---|
| **Auth before mutation** | `contributor.require_auth()` is called before any state write. Unauthenticated callers are rejected at the host level — no storage is touched. |
| **Transfer before storage** | The token transfer executes before any `env.storage()` write. If the transfer fails, the transaction reverts atomically — no partial state is persisted. |
| **Overflow protection** | Both the per-contributor running total and `total_raised` use `checked_add`, returning `ContractError::Overflow` (code 6) rather than wrapping silently. No arithmetic in the contribution path can overflow without being caught. |
| **Deadline boundary** | The check is `ledger.timestamp() > deadline` (strict `>`). A contribution submitted at exactly the deadline timestamp is **accepted**. Scripts computing campaign open/closed status should use `>` not `>=`. |
| **AmountTooLow is typed** | `amount < min_contribution` now returns `Err(ContractError::AmountTooLow)` — scripts can distinguish it from host panics and display a meaningful message to users. |

---

## Off-chain Script Usage

```rust
use crowdfund::contribute_error_handling::{describe_error, error_codes};

match client.try_contribute(&contributor, &amount) {
    Ok(_) => println!("contributed successfully"),
    Err(Ok(e)) => {
        let code = e as u32;
        eprintln!("contract error {code}: {}", describe_error(code));
        // code 9 → prompt user to increase their amount
        // code 2 → inform user the campaign has closed
    }
    Err(Err(e)) => eprintln!("host error: {e:?}"),
}
```

### TypeScript / JavaScript (Stellar SDK)

```typescript
const ERROR_CODES: Record<number, string> = {
  2: "Campaign has ended",
  6: "Arithmetic overflow — contribution amount too large",
  9: "Contribution amount is below the campaign minimum",
};

try {
  await contract.contribute({ contributor, amount });
} catch (e) {
  const code = e?.errorCode as number | undefined;
  console.error(code ? ERROR_CODES[code] ?? "Unknown error" : e);
}
```

---

## Constants

Defined in `contribute_error_handling::error_codes`:

```rust
pub const CAMPAIGN_ENDED: u32 = 2;
pub const OVERFLOW:       u32 = 6;
pub const AMOUNT_TOO_LOW: u32 = 9;
```

The minimum contribution threshold itself is stored in instance storage under
`DataKey::MinContribution` and set during `initialize()`. It is readable
off-chain via the `min_contribution()` view function:

```bash
stellar contract invoke --id <CONTRACT> -- min_contribution
```

---

## Test Coverage

See [`contracts/crowdfund/src/contribute_error_handling_tests.rs`](../contracts/crowdfund/src/contribute_error_handling_tests.rs).

| Test | Scenario |
|---|---|
| `contribute_happy_path` | Valid amount, before deadline — succeeds |
| `contribute_below_minimum_returns_amount_too_low` | `amount = MIN - 1` → `AmountTooLow` (code 9) |
| `contribute_zero_amount_returns_amount_too_low` | `amount = 0` → `AmountTooLow` (code 9) |
| `contribute_negative_amount_returns_amount_too_low` | `amount = -1` → `AmountTooLow` (code 9) |
| `contribute_after_deadline_returns_campaign_ended` | Past deadline → `CampaignEnded` (code 2) |
| `contribute_exactly_at_deadline_is_accepted` | `timestamp == deadline` → accepted |
| `overflow_error_code_matches_contract_error_repr` | `OVERFLOW` constant == `ContractError::Overflow as u32` |
| `amount_too_low_error_code_matches_contract_error_repr` | `AMOUNT_TOO_LOW` constant == `ContractError::AmountTooLow as u32` |
| `describe_error_campaign_ended` | Code 2 → correct string |
| `describe_error_overflow` | Code 6 → correct string |
| `describe_error_amount_too_low` | Code 9 → correct string |
| `describe_error_unknown` | Code 99 → "Unknown error" |
| `is_retryable_returns_false_for_all_known_errors` | All known codes → `false` |
