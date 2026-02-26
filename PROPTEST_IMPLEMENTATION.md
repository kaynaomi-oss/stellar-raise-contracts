# Property-Based Testing Implementation with Proptest

## Overview

This document describes the implementation of property-based fuzz testing using the `proptest` crate for the Stellar Raise crowdfunding contract. Property-based testing automatically explores edge cases and boundary conditions, significantly increasing confidence in contract correctness.

## Implementation Summary

### 1. Dependencies Added

**File**: `contracts/crowdfund/Cargo.toml`

```toml
[dev-dependencies]
soroban-sdk = { workspace = true, features = ["testutils"] }
proptest = "1.4"
```

The `proptest` crate was added as a dev-dependency with version 1.4, enabling property-based testing capabilities.

### 2. Property-Based Tests Implemented

**File**: `contracts/crowdfund/src/test.rs`

Ten comprehensive property-based tests were added to validate contract invariants:

#### **Property Test 1: Total Raised Equals Sum of Contributions**
- **Invariant**: `total_raised == sum(all contributions)`
- **Test**: Generates random valid goals, deadlines, and contribution amounts from 3 contributors
- **Validation**: Verifies the total matches the sum of individual contributions
- **Edge Cases Explored**: Various contribution amounts, different goal values, deadline offsets

#### **Property Test 2: Refund Returns Exact Contributed Amount**
- **Invariant**: Each contributor receives back exactly their contribution with no remainder or shortfall
- **Test**: Generates random contribution amounts below the goal
- **Validation**: Confirms refund amount equals original contribution
- **Edge Cases Explored**: Boundary contributions, various goal amounts, different deadlines

#### **Property Test 3: Contribute with Amount ≤ 0 Always Fails**
- **Invariant**: Zero and negative contributions must be rejected
- **Test**: Generates zero and negative contribution amounts
- **Validation**: Verifies `try_contribute` returns an error
- **Edge Cases Explored**: Exactly zero, negative values, boundary conditions

#### **Property Test 4: Deadline in the Past Always Fails on Initialize**
- **Invariant**: Past deadlines should be rejected or result in expired campaigns
- **Test**: Generates past deadline timestamps
- **Validation**: Verifies initialization behavior with past deadlines
- **Edge Cases Explored**: Various past offsets, boundary timestamps

#### **Property Test 5: Multiple Contributions Accumulate Correctly**
- **Invariant**: Total raised equals sum of all contributions from multiple contributors
- **Test**: Generates 3 contributors with random contribution amounts
- **Validation**: Verifies total and individual tracking
- **Edge Cases Explored**: Different contribution amounts, multiple contributors

#### **Property Test 6: Withdrawal Transfers Exact Amount**
- **Invariant**: Withdrawal transfers exactly `total_raised` to creator
- **Test**: Generates goals and contributions that meet the goal
- **Validation**: Confirms creator receives exact amount and total_raised resets to 0
- **Edge Cases Explored**: Various goal amounts, different contribution patterns

#### **Property Test 7: Contribution Tracking Persists Across Multiple Calls**
- **Invariant**: Multiple contributions from same contributor accumulate correctly
- **Test**: Generates 3 sequential contributions from one contributor
- **Validation**: Verifies running total after each contribution
- **Edge Cases Explored**: Multiple contribution sequences, accumulation patterns

#### **Property Test 8: Refund Resets Total Raised to Zero**
- **Invariant**: After refund, `total_raised` must be 0
- **Test**: Generates valid refund scenarios (goal not met, deadline passed)
- **Validation**: Confirms total_raised is 0 after refund
- **Edge Cases Explored**: Various contribution amounts, different goals

#### **Property Test 9: Contribution Below Minimum Always Fails**
- **Invariant**: Contributions below minimum must fail
- **Test**: Generates amounts below the minimum contribution threshold
- **Validation**: Verifies `try_contribute` returns an error
- **Edge Cases Explored**: Just below minimum, various minimums, boundary values

#### **Property Test 10: Contribution After Deadline Always Fails**
- **Invariant**: Contributions after deadline must fail with `CampaignEnded` error
- **Test**: Generates contributions after deadline has passed
- **Validation**: Verifies error type and failure condition
- **Edge Cases Explored**: Various times after deadline, boundary conditions

### 3. CI Integration

**File**: `.github/workflows/rust_ci.yml`

The CI workflow was updated to run property-based tests with explicit case count:

```yaml
- name: Run tests including property-based tests
  env:
    PROPTEST_CASES: 1000
  run: cargo test --workspace
```

**Configuration**:
- `PROPTEST_CASES: 1000` - Each property test runs 1000 random test cases
- Integrated into existing test step
- Runs on all pull requests and pushes to main branch

### 4. Test Results

All tests pass successfully:

```
running 57 tests
...
test result: ok. 57 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

**Test Breakdown**:
- 10 new property-based tests (proptest)
- 47 existing unit tests
- Total: 57 tests passing

### 5. Key Invariants Validated

The property-based tests validate the following critical invariants:

1. **Accounting Invariant**: `total_raised` always equals the sum of all contributions
2. **Refund Invariant**: Each contributor receives back exactly what they contributed
3. **Input Validation**: Invalid inputs (≤0 amounts, past deadlines) are rejected
4. **State Consistency**: Contribution tracking persists correctly across operations
5. **Withdrawal Invariant**: Withdrawal transfers exact amounts and resets state
6. **Deadline Enforcement**: Contributions after deadline are rejected
7. **Minimum Enforcement**: Contributions below minimum are rejected

## Running the Tests

### Local Development

Run all tests including property-based tests:
```bash
cargo test --lib
```

Run only property-based tests:
```bash
cargo test --lib prop
```

Run with custom case count:
```bash
PROPTEST_CASES=5000 cargo test --lib
```

### CI Pipeline

Property-based tests run automatically on:
- Pull requests to `main` branch
- Pushes to `main` branch
- Each run executes 1000 test cases per property test

## Benefits

1. **Comprehensive Coverage**: Automatically explores thousands of edge cases
2. **Regression Prevention**: Catches subtle bugs that manual tests might miss
3. **Confidence**: Validates contract invariants hold across diverse inputs
4. **Documentation**: Tests serve as executable specifications of expected behavior
5. **Scalability**: Easy to add more property tests for new features

## Future Enhancements

1. **Increase Case Count**: Run 5000+ cases in CI for even more thorough testing
2. **Additional Properties**: Add tests for platform fees, stretch goals, metadata updates
3. **Shrinking**: Proptest automatically shrinks failing cases to minimal examples
4. **Stateful Testing**: Use proptest's stateful testing for complex operation sequences
5. **Performance Testing**: Add property tests for gas efficiency and performance bounds

## References

- [Proptest Documentation](https://docs.rs/proptest/)
- [Property-Based Testing Guide](https://hypothesis.works/articles/what-is-property-based-testing/)
- [Soroban SDK Testing](https://soroban.stellar.org/docs/learn/testing)

## Commit Information

This implementation follows the specification in the GitHub issue for property-based fuzz testing:

- Added `proptest = "1.4"` as dev-dependency
- Implemented 10 comprehensive property-based tests
- Updated CI workflow with `PROPTEST_CASES=1000`
- All tests pass successfully
- No breaking changes to existing functionality
