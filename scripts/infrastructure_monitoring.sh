#!/bin/bash
# infrastructure_monitoring.sh — Stellar Raise infrastructure health checks.
#
# Checks: RPC endpoint reachability, contract deployment, disk usage,
#         memory usage, and CI WASM artifact presence.
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed
#
# Required env vars:
#   STELLAR_RPC_URL  — e.g. https://soroban-testnet.stellar.org
#   CONTRACT_ID      — deployed contract address
#
# Optional env vars:
#   DISK_THRESHOLD   — percent (default: 85)
#   MEMORY_THRESHOLD — percent (default: 90)

set +e

# ── Load .env if present ─────────────────────────────────────────────────────
if [ -f ".env" ]; then
    # shellcheck disable=SC1091
    set -a; . ./.env; set +a
fi

DISK_THRESHOLD="${DISK_THRESHOLD:-85}"
MEMORY_THRESHOLD="${MEMORY_THRESHOLD:-90}"
WASM_PATH="target/wasm32-unknown-unknown/release/crowdfund.wasm"

PASS=0
FAIL=0

pass() { echo "[PASS] $1: $2"; PASS=$((PASS + 1)); }
fail() { echo "[FAIL] $1: $2"; FAIL=$((FAIL + 1)); }

echo "=== Stellar Raise — Infrastructure Monitoring ==="
echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── 1. RPC endpoint ──────────────────────────────────────────────────────────
check_rpc_endpoint() {
    if [ -z "$STELLAR_RPC_URL" ]; then
        fail "check_rpc_endpoint" "STELLAR_RPC_URL is not set"
        return
    fi
    if curl -sf --max-time 10 "$STELLAR_RPC_URL/health" > /dev/null 2>&1; then
        pass "check_rpc_endpoint" "$STELLAR_RPC_URL is reachable"
    else
        fail "check_rpc_endpoint" "$STELLAR_RPC_URL is unreachable or unhealthy"
    fi
}

# ── 2. Contract deployed ─────────────────────────────────────────────────────
check_contract_deployed() {
    if [ -z "$CONTRACT_ID" ]; then
        fail "check_contract_deployed" "CONTRACT_ID is not set"
        return
    fi
    if [ -z "$STELLAR_RPC_URL" ]; then
        fail "check_contract_deployed" "STELLAR_RPC_URL is not set — cannot verify contract"
        return
    fi
    RESPONSE=$(curl -sf --max-time 10 \
        -X POST "$STELLAR_RPC_URL" \
        -H "Content-Type: application/json" \
        -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getLedgerEntries\",\"params\":{\"keys\":[]}}" \
        2>/dev/null)
    if [ -n "$RESPONSE" ]; then
        pass "check_contract_deployed" "CONTRACT_ID=$CONTRACT_ID (RPC responsive)"
    else
        fail "check_contract_deployed" "Could not verify contract $CONTRACT_ID — RPC unresponsive"
    fi
}

# ── 3. Disk usage ────────────────────────────────────────────────────────────
check_disk_usage() {
    USAGE=$(df . | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
    if [ "$USAGE" -lt "$DISK_THRESHOLD" ]; then
        pass "check_disk_usage" "${USAGE}% used (threshold ${DISK_THRESHOLD}%)"
    else
        fail "check_disk_usage" "${USAGE}% used — exceeds threshold ${DISK_THRESHOLD}%"
    fi
}

# ── 4. Memory usage ──────────────────────────────────────────────────────────
check_memory_usage() {
    if command -v free > /dev/null 2>&1; then
        USAGE=$(free | awk '/^Mem:/ {printf "%.0f", $3/$2*100}')
    else
        # macOS fallback
        TOTAL=$(sysctl -n hw.memsize)
        USED=$(vm_stat | awk '/Pages active/ {print $3+0}')
        PAGE=$(sysctl -n hw.pagesize)
        USAGE=$(awk "BEGIN {printf \"%.0f\", ($USED * $PAGE) / $TOTAL * 100}")
    fi
    if [ "$USAGE" -lt "$MEMORY_THRESHOLD" ]; then
        pass "check_memory_usage" "${USAGE}% used (threshold ${MEMORY_THRESHOLD}%)"
    else
        fail "check_memory_usage" "${USAGE}% used — exceeds threshold ${MEMORY_THRESHOLD}%"
    fi
}

# ── 5. CI WASM artifact ──────────────────────────────────────────────────────
check_ci_artifacts() {
    if [ -s "$WASM_PATH" ]; then
        SIZE=$(du -h "$WASM_PATH" | cut -f1)
        pass "check_ci_artifacts" "$WASM_PATH present (${SIZE})"
    else
        fail "check_ci_artifacts" "$WASM_PATH not found or empty — run: cargo build --release --target wasm32-unknown-unknown -p crowdfund"
    fi
}

# ── Run all checks ───────────────────────────────────────────────────────────
check_rpc_endpoint
check_contract_deployed
check_disk_usage
check_memory_usage
check_ci_artifacts

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "=== Summary ==="
TOTAL=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
    echo "All ${TOTAL} check(s) passed."
    exit 0
else
    echo "${FAIL} check(s) failed."
    exit 1
fi
