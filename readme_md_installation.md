# Comprehensive Installation Guide for Stellar Raise Contracts

## Table of Contents
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Detailed Setup](#detailed-setup)
- [Verification](#verification)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Security Assumptions](#security-assumptions)
- [Testing](#testing)
- [Development](#development)

## Prerequisites
| Tool | Version | Install Command |
|------|---------|-----------------|
| Rust | stable | [rustup.rs](https://rustup.rs) |
| wasm32 target | - | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI | latest | `curl -Ls https://soroban.stellar.org/install-soroban.sh \| sh` |
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| Git | 2.0+ | OS package manager |

**Windows Users**: Use WSL2 for best compatibility.

## Quick Start
```bash
git clone https://github.com/Mac-5/stellar-raise-contracts.git
cd stellar-raise-contracts
rustup target add wasm32-unknown-unknown
curl -Ls https://soroban.stellar.org/install-soroban.sh | sh
npm ci  # Frontend deps
cargo build --release --target wasm32-unknown-unknown
cargo test
npm test
```

## Detailed Setup

### 1. Clone Repository
```bash
git clone https://github.com/Mac-5/stellar-raise-contracts.git
cd stellar-raise-contracts
git checkout develop
```

### 2. Install Rust & WASM Target
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
rustup target add wasm32-unknown-unknown
```

### 3. Install Stellar CLI
```bash
curl -Ls https://soroban.stellar.org/install-soroban.sh | sh
# Verify
stellar --version
```

**Note**: `soroban` commands are now `stellar` (updated CLI).

### 4. Frontend Dependencies
```bash
npm ci
```

### 5. Build Contracts
```bash
cargo build --release --target wasm32-unknown-unknown -p crowdfund
# Output: contracts/crowdfund/target/wasm32-unknown-unknown/release/crowdfund.wasm
```

## Verification
Run `readme_md_installation.test.js`:
```bash
npm test readme_md_installation.test.js
```

Expected: All checks pass (Rust, wasm target, Stellar CLI, cargo build).

## Deployment
### Automated Script
```bash
DEADLINE=$(date -d '+30 days' +%s)
./scripts/deployment_shell_script.sh \\
  'GYOUR_CREATOR_ADDRESS' 'GTOKEN_ADDRESS' 1000000000 $DEADLINE 10000000
```

**Exit Codes**:
| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Missing tool |
| 2 | Bad args |
| 3 | Build fail |
| 4 | Deploy fail |
| 5 | Init fail |

### Manual
```bash
# Build
cargo build --release --target wasm32-unknown-unknown -p crowdfund

# Install WASM
stellar contract install \\
  --wasm contracts/crowdfund/target/wasm32-unknown-unknown/release/crowdfund.wasm \\
  --source YOUR_SECRET \\
  --network testnet

# Initialize
stellar contract invoke ... -- initialize --creator ... --token ... --goal ... --deadline ... --min_contribution ...
```

## Troubleshooting
| Issue | Solution |
|-------|----------|
| `wasm32-unknown-unknown` not found | `rustup target add wasm32-unknown-unknown` |
| `stellar: command not found` | Re-run Stellar CLI install script |
| `cargo build` fails | `rustup update stable` |
| Windows path issues | Use WSL2 |
| Tests timeout | Increase `cargo test -- --test-threads=1` |

## Security Assumptions {#security-assumptions}
- **Admin Auth**: Only creator/admin can `initialize`, `withdraw`, `upgrade` (require_auth enforced).
- **Contributor Auth**: `contribute`/`refund_single` requires caller auth.
- **Pull Refunds**: Individual claims prevent gas DoS (scalable).
- **Upgrade Safety**: WASM hash validated; storage preserved.
- **Bounds**: Goal/deadline/min contrib validated (proptest covered).
- **Platform Fee**: Capped <100%.
- **Events**: Bounded emission (MAX_NFT_MINT_BATCH).

All validated in `contracts/crowdfund/src/*.rs` tests.

## Testing {#testing}
```bash
cargo test --workspace  # Contracts (100% coverage)
npm test                # Frontend + installation tests
```

## Development {#development}
- Branch: `git checkout -b feat/your-feature develop`
- Format: `cargo fmt --all`
- Lint: `cargo clippy --all-targets`
- PR to `develop`

**NatSpec-style Comments**: All public fns documented with `/// @notice`, `/// @param`.

---
*Last updated: $(date)* | [Edit on GitHub](...)"

