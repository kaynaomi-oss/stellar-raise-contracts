#!/usr/bin/env bash
# github_actions_test.test.sh
#
# Tests for github_actions_test.sh.
# Uses a temporary directory to simulate pass and fail scenarios.
#
# Usage:
#   bash scripts/github_actions_test.test.sh

set -euo pipefail

SCRIPT="scripts/github_actions_test.sh"
passed=0
failed=0

# ── Helpers ───────────────────────────────────────────────────────────────────

assert_exit() {
  local desc="$1" expected="$2"
  shift 2
  set +e
  "$@" > /dev/null 2>&1
  local actual=$?
  set -e
  if [[ "$actual" -eq "$expected" ]]; then
    echo "PASS: $desc"
    passed=$((passed + 1))
  else
    echo "FAIL: $desc (expected exit $expected, got $actual)"
    failed=$((failed + 1))
  fi
}

OLDPWD="$(pwd)"

# ── Test 1: passes on the real (fixed) repo ───────────────────────────────────

assert_exit "real repo passes all checks" 0 bash "$SCRIPT"

# ── Test 2: fails when a workflow file is missing ─────────────────────────────

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

mkdir -p "$tmpdir/.github/workflows"
# Only create two of the three required files
echo "name: Rust CI" > "$tmpdir/.github/workflows/rust_ci.yml"
echo "name: Smoke"   > "$tmpdir/.github/workflows/testnet_smoke.yml"
# spellcheck.yml intentionally absent

assert_exit "fails when spellcheck.yml is missing" 1 bash -c "cd '$tmpdir' && bash '$OLDPWD/$SCRIPT'"

# ── Test 3: fails when checkout@v6 typo is present ────────────────────────────

tmpdir2=$(mktemp -d)
trap 'rm -rf "$tmpdir2"' EXIT

mkdir -p "$tmpdir2/.github/workflows"
cat > "$tmpdir2/.github/workflows/rust_ci.yml" <<'EOF'
name: Rust CI
jobs:
  check:
    steps:
      - uses: actions/checkout@v6
      - run: cargo build --release --target wasm32-unknown-unknown -p crowdfund
EOF
echo "name: Smoke"     > "$tmpdir2/.github/workflows/testnet_smoke.yml"
echo "name: Spellcheck" > "$tmpdir2/.github/workflows/spellcheck.yml"

assert_exit "fails when checkout@v6 typo is present" 1 bash -c "cd '$tmpdir2' && bash '$OLDPWD/$SCRIPT'"

# ── Test 4: fails when duplicate WASM build steps exist ───────────────────────

tmpdir3=$(mktemp -d)
trap 'rm -rf "$tmpdir3"' EXIT

mkdir -p "$tmpdir3/.github/workflows"
cat > "$tmpdir3/.github/workflows/rust_ci.yml" <<'EOF'
name: Rust CI
jobs:
  check:
    steps:
      - uses: actions/checkout@v4
      - run: cargo build --release --target wasm32-unknown-unknown -p crowdfund
      - run: cargo build --release --target wasm32-unknown-unknown
EOF
echo "name: Smoke"      > "$tmpdir3/.github/workflows/testnet_smoke.yml"
echo "name: Spellcheck" > "$tmpdir3/.github/workflows/spellcheck.yml"

assert_exit "fails when duplicate WASM build steps exist" 1 bash -c "cd '$tmpdir3' && bash '$OLDPWD/$SCRIPT'"

# ── Test 5: fails when smoke test calls non-existent is_initialized ───────────

tmpdir4=$(mktemp -d)
trap 'rm -rf "$tmpdir4"' EXIT

mkdir -p "$tmpdir4/.github/workflows"
echo "name: Rust CI"    > "$tmpdir4/.github/workflows/rust_ci.yml"
echo "name: Spellcheck" > "$tmpdir4/.github/workflows/spellcheck.yml"
cat > "$tmpdir4/.github/workflows/testnet_smoke.yml" <<'EOF'
name: Smoke
jobs:
  smoke-test:
    steps:
      - uses: actions/checkout@v4
      - run: soroban contract invoke --id $ID -- is_initialized
      - run: soroban contract invoke --id $ID -- initialize --admin $A --creator $A --token T --goal 1000 --deadline 9999 --min_contribution 1
EOF

assert_exit "fails when smoke test calls is_initialized (non-existent)" 1 bash -c "cd '$tmpdir4' && bash '$OLDPWD/$SCRIPT'"

# ── Test 6: fails when smoke test initialize is missing --admin ───────────────

tmpdir5=$(mktemp -d)
trap 'rm -rf "$tmpdir5"' EXIT

mkdir -p "$tmpdir5/.github/workflows"
echo "name: Rust CI"    > "$tmpdir5/.github/workflows/rust_ci.yml"
echo "name: Spellcheck" > "$tmpdir5/.github/workflows/spellcheck.yml"
cat > "$tmpdir5/.github/workflows/testnet_smoke.yml" <<'EOF'
name: Smoke
jobs:
  smoke-test:
    steps:
      - uses: actions/checkout@v4
      - run: soroban contract invoke --id $ID -- initialize --creator $A --token T --goal 1000 --deadline 9999 --min_contribution 1
EOF

assert_exit "fails when smoke test initialize is missing --admin" 1 bash -c "cd '$tmpdir5' && bash '$OLDPWD/$SCRIPT'"

# ── Test 7: fails when smoke test WASM build is missing -p crowdfund ──────────

tmpdir6=$(mktemp -d)
trap 'rm -rf "$tmpdir6"' EXIT

mkdir -p "$tmpdir6/.github/workflows"
echo "name: Rust CI"    > "$tmpdir6/.github/workflows/rust_ci.yml"
echo "name: Spellcheck" > "$tmpdir6/.github/workflows/spellcheck.yml"
cat > "$tmpdir6/.github/workflows/testnet_smoke.yml" <<'EOF'
name: Smoke
jobs:
  smoke-test:
    steps:
      - uses: actions/checkout@v4
      - run: cargo build --target wasm32-unknown-unknown --release
      - run: stellar contract invoke --id $ID -- initialize --admin $A --creator $A --token T --goal 1000 --deadline 9999 --min_contribution 1
EOF

assert_exit "fails when smoke test WASM build is missing -p crowdfund" 1 bash -c "cd '$tmpdir6' && bash '$OLDPWD/$SCRIPT'"

# ── Test 8: fails when smoke test uses deprecated soroban-cli ─────────────────

tmpdir7=$(mktemp -d)
trap 'rm -rf "$tmpdir7"' EXIT

mkdir -p "$tmpdir7/.github/workflows"
echo "name: Rust CI"    > "$tmpdir7/.github/workflows/rust_ci.yml"
echo "name: Spellcheck" > "$tmpdir7/.github/workflows/spellcheck.yml"
cat > "$tmpdir7/.github/workflows/testnet_smoke.yml" <<'EOF'
name: Smoke
jobs:
  smoke-test:
    steps:
      - uses: actions/checkout@v4
      - run: cargo install soroban-cli
      - run: cargo build --target wasm32-unknown-unknown --release -p crowdfund
      - run: stellar contract invoke --id $ID -- initialize --admin $A --creator $A --token T --goal 1000 --deadline 9999 --min_contribution 1
EOF

assert_exit "fails when smoke test uses deprecated soroban-cli" 1 bash -c "cd '$tmpdir7' && bash '$OLDPWD/$SCRIPT'"

# ── Test 9: fails when rust_ci.yml is missing the frontend job ────────────────

tmpdir8=$(mktemp -d)
trap 'rm -rf "$tmpdir8"' EXIT

mkdir -p "$tmpdir8/.github/workflows"
cat > "$tmpdir8/.github/workflows/rust_ci.yml" <<'EOF'
name: Rust CI
jobs:
  check:
    steps:
      - uses: actions/checkout@v4
      - run: cargo build --release --target wasm32-unknown-unknown -p crowdfund
EOF
echo "name: Smoke"      > "$tmpdir8/.github/workflows/testnet_smoke.yml"
echo "name: Spellcheck" > "$tmpdir8/.github/workflows/spellcheck.yml"

assert_exit "fails when rust_ci.yml is missing the frontend job" 1 bash -c "cd '$tmpdir8' && bash '$OLDPWD/$SCRIPT'"

# ── Test 10: fails when smoke test calls non-existent get_stats ───────────────

tmpdir9=$(mktemp -d)
trap 'rm -rf "$tmpdir9"' EXIT

mkdir -p "$tmpdir9/.github/workflows"
echo "name: Rust CI"    > "$tmpdir9/.github/workflows/rust_ci.yml"
echo "name: Spellcheck" > "$tmpdir9/.github/workflows/spellcheck.yml"
cat > "$tmpdir9/.github/workflows/testnet_smoke.yml" <<'EOF'
name: Smoke
jobs:
  smoke-test:
    steps:
      - uses: actions/checkout@v4
      - run: cargo build --target wasm32-unknown-unknown --release -p crowdfund
      - run: stellar contract invoke --id $ID -- initialize --admin $A --creator $A --token T --goal 1000 --deadline 9999 --min_contribution 1
      - run: stellar contract invoke --id $ID -- get_stats
EOF

assert_exit "fails when smoke test calls non-existent get_stats" 1 bash -c "cd '$tmpdir9' && bash '$OLDPWD/$SCRIPT'"

# ── Test 11: fails when rust_ci.yml has no timeout-minutes ────────────────────

tmpdir10=$(mktemp -d)
trap 'rm -rf "$tmpdir10"' EXIT

mkdir -p "$tmpdir10/.github/workflows"
cat > "$tmpdir10/.github/workflows/rust_ci.yml" <<'EOF'
name: Rust CI
jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cargo build --release --target wasm32-unknown-unknown -p crowdfund
EOF
echo "name: Smoke"      > "$tmpdir10/.github/workflows/testnet_smoke.yml"
echo "name: Spellcheck" > "$tmpdir10/.github/workflows/spellcheck.yml"

assert_exit "fails when rust_ci.yml has no timeout-minutes" 1 bash -c "cd '$tmpdir10' && bash '$OLDPWD/$SCRIPT'"

# ── Test 12: fails when rust_ci.yml has no elapsed-time logging ───────────────

tmpdir11=$(mktemp -d)
trap 'rm -rf "$tmpdir11"' EXIT

mkdir -p "$tmpdir11/.github/workflows"
cat > "$tmpdir11/.github/workflows/rust_ci.yml" <<'EOF'
name: Rust CI
jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - name: Build crowdfund WASM for tests
        timeout-minutes: 10
        run: cargo build --release --target wasm32-unknown-unknown -p crowdfund
      - name: Run tests including property-based tests
        timeout-minutes: 15
        run: cargo test --workspace
EOF
echo "name: Smoke"      > "$tmpdir11/.github/workflows/testnet_smoke.yml"
echo "name: Spellcheck" > "$tmpdir11/.github/workflows/spellcheck.yml"

assert_exit "fails when rust_ci.yml has no elapsed-time logging" 1 bash -c "cd '$tmpdir11' && bash '$OLDPWD/$SCRIPT'"

# ── Test 13: fails when rust_ci.yml test step has no timeout-minutes ──────────

tmpdir12=$(mktemp -d)
trap 'rm -rf "$tmpdir12"' EXIT

mkdir -p "$tmpdir12/.github/workflows"
cat > "$tmpdir12/.github/workflows/rust_ci.yml" <<'EOF'
name: Rust CI
jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Record job start time
        run: echo "JOB_START=$(date +%s)" >> "$GITHUB_ENV"
      - uses: actions/checkout@v4
      - name: Build crowdfund WASM for tests
        timeout-minutes: 10
        run: cargo build --release --target wasm32-unknown-unknown -p crowdfund
      - name: Run tests including property-based tests
        run: cargo test --workspace
      - name: Log total job elapsed time
        if: always()
        run: |
          END=$(date +%s)
          ELAPSED=$(( END - JOB_START ))
          echo "Total job time: ${ELAPSED}s"
EOF
echo "name: Smoke"      > "$tmpdir12/.github/workflows/testnet_smoke.yml"
echo "name: Spellcheck" > "$tmpdir12/.github/workflows/spellcheck.yml"

assert_exit "fails when rust_ci.yml test step has no timeout-minutes" 1 bash -c "cd '$tmpdir12' && bash '$OLDPWD/$SCRIPT'"

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "Results: $passed passed, $failed failed"
[[ "$failed" -eq 0 ]]
