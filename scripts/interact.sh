#!/bin/bash
set -e

# Usage: ./scripts/interact.sh <contract_id> <action> [args...]
# Examples:
#   ./scripts/interact.sh C... contribute G... 100
#   ./scripts/interact.sh C... withdraw
#   ./scripts/interact.sh C... refund

CONTRACT_ID=${1:?Usage: $0 <contract_id> <action> [args...]}
ACTION=${2:?missing action: contribute | withdraw | refund}
NETWORK="testnet"

case "$ACTION" in
contribute)
  CONTRIBUTOR=${3:?missing contributor}
  AMOUNT=${4:?missing amount}
  soroban contract invoke \
    --id "$CONTRACT_ID" \
    --network "$NETWORK" \
    --source "$CONTRIBUTOR" \
    -- \
    contribute \
    --contributor "$CONTRIBUTOR" \
    --amount "$AMOUNT"
  echo "Contribution of $AMOUNT from $CONTRIBUTOR successful."
  ;;
withdraw)
  CREATOR=${3:?missing creator (source account)}
  soroban contract invoke \
    --id "$CONTRACT_ID" \
    --network "$NETWORK" \
    --source "$CREATOR" \
    -- \
    withdraw
  echo "Withdraw successful."
  ;;
refund)
  CALLER=${3:?missing caller (source account)}
  soroban contract invoke \
    --id "$CONTRACT_ID" \
    --network "$NETWORK" \
    --source "$CALLER" \
    -- \
    refund
  echo "Refund successful."
  ;;
*)
  echo "Unknown action: $ACTION. Use contribute | withdraw | refund"
  exit 1
  ;;
esac
