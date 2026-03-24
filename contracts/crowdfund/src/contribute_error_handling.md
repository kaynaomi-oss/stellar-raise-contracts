# contribute_error_handling

Typed error codes and diagnostic helpers for the `contribute()` entry point.

## Overview

This module replaces ad-hoc panic strings with typed `ContractError` variants and provides:

- **`error_codes`** — numeric constants matching `ContractError`'s `#[repr(u32)]` values for off-chain use.
- **`describe_error(code)`** — human-readable message for any error code.
- **`is_retryable(code)`** — distinguishes input errors (caller can fix and retry) from permanent state errors.
- **`log_contribute_error(env, error)`** — emits a structured diagnostic event before each error return.

## Error Reference

| Code | Variant            | Trigger                              | Retryable |
|------|--------------------|--------------------------------------|-----------|
| 2    | `CampaignEnded`    | `ledger.timestamp > deadline`        | No        |
| 6    | `Overflow`         | checked_add would overflow           | No        |
| 8    | `ZeroAmount`       | `amount == 0`                        | Yes       |
| 9    | `BelowMinimum`     | `amount < min_contribution`          | Yes       |
| 10   | `CampaignNotActive`| campaign status ≠ `Active`           | No        |
| 11   | `NegativeAmount`   | `amount < 0`                         | Yes       |

## Validation Order in `contribute()`

```
1. status != Active       → CampaignNotActive  (checked first — fast exit)
2. amount < 0             → NegativeAmount
3. amount == 0            → ZeroAmount
4. amount < min           → BelowMinimum
5. timestamp > deadline   → CampaignEnded
6. checked_add overflows  → Overflow
```

## Diagnostic Events

Each error path emits a `contribute_error` event before returning:

| Topic 0            | Topic 1                  | Data   |
|--------------------|--------------------------|--------|
| `contribute_error` | `Symbol(<VariantName>)`  | `u32`  |

Off-chain indexers can subscribe to `contribute_error` to observe failures without parsing host-level error codes.

## Security Considerations

- `contributor.require_auth()` is called before any validation — auth failure is always the first gate.
- Negative amounts are rejected before zero/minimum checks to prevent unexpected token-level behaviour.
- The deadline check uses strict `>`: contributions at exactly the deadline timestamp are accepted.
- `log_contribute_error` is read-only and cannot be called externally.
# contribute() Error Handling

## Overview

Deprecates old panic-based guards in `contribute()` and replaces them with
typed `ContractError` variants, enabling scripts and CI/CD pipelines to handle
all error paths programmatically.

## Deprecation Notice

The following untyped panics have been **removed** and replaced:

| Old behaviour                        | New typed error              |
| :----------------------------------- | :--------------------------- |
| `panic!("amount below minimum")`     | `ContractError::BelowMinimum` (code 9) |
| zero-amount pass-through (no guard)  | `ContractError::ZeroAmount` (code 8)   |
| no campaign-status guard             | `ContractError::CampaignNotActive` (code 10) |

## Error Reference

| Code | Variant               | Trigger                                          | Retryable |
| :--- | :-------------------- | :----------------------------------------------- | :-------- |
| 2    | `CampaignEnded`       | `ledger.timestamp > deadline`                    | No        |
| 6    | `Overflow`            | `checked_add` would wrap on contribution totals  | No        |
| 8    | `ZeroAmount`          | `amount == 0`                                    | No        |
| 9    | `BelowMinimum`        | `amount < min_contribution`                      | No        |
| 10   | `CampaignNotActive`   | campaign status is not `Active`                  | No        |

## Security Assumptions

- `contributor.require_auth()` is called before any state mutation.
- Campaign status is checked first — cancelled/successful campaigns are
  rejected before any other validation.
- Token transfer happens before storage writes; failures roll back atomically.
- Overflow is caught with `checked_add` on both per-contributor and global totals.
- The deadline check uses strict `>`, so a contribution at exactly the deadline
  timestamp is **accepted**. Scripts should account for this boundary.

## Usage in Scripts

```rust
use crowdfund::contribute_error_handling::{describe_error, error_codes};

match client.try_contribute(&contributor, &amount) {
    Ok(_) => println!("contributed"),
    Err(Ok(e)) => eprintln!("contract error {}: {}", e as u32, describe_error(e as u32)),
    Err(Err(e)) => eprintln!("host error: {:?}", e),
}
```

## Module Location

`contracts/crowdfund/src/contribute_error_handling.rs`

## Tests

`contracts/crowdfund/src/contribute_error_handling_tests.rs`

17 tests — all passing:

```
contribute_happy_path                                    ok
contribute_accumulates_multiple_contributions            ok
contribute_after_deadline_returns_campaign_ended         ok
contribute_exactly_at_deadline_is_accepted               ok
contribute_below_minimum_returns_typed_error             ok
contribute_one_below_minimum_returns_below_minimum       ok
contribute_zero_amount_returns_typed_error               ok
contribute_to_cancelled_campaign_returns_not_active      ok
contribute_to_successful_campaign_returns_not_active     ok
overflow_error_code_is_correct                           ok
describe_error_campaign_ended                            ok
describe_error_overflow                                  ok
describe_error_zero_amount                               ok
describe_error_below_minimum                             ok
describe_error_campaign_not_active                       ok
describe_error_unknown                                   ok
is_retryable_returns_false_for_all_known_errors          ok
```
