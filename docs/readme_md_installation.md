# Installation Edge Cases & Environment Verification

This document supplements the main [README.md](../README.md) with detailed edge-case
troubleshooting, automated verification steps, and security guidance for the
Stellar Raise development environment.

---

## Minimum Requirements

| Requirement  | Minimum | Notes                                      |
| :----------- | :------ | :----------------------------------------- |
| OS           | Linux x86-64 or macOS 12+ | WSL2 on Windows          |
| Rust         | stable ≥ 1.74 | `rustup update stable`               |
| Stellar CLI  | ≥ 20.0.0 | Renamed from `soroban` in v20           |
| Node.js      | ≥ 18    | Required for frontend UI and JS tests      |
| npm          | ≥ 9     | Bundled with Node.js 18+                   |

---

## Automated Verification

Run the provided script to verify your environment meets all requirements:

```bash
./scripts/verify_env.sh
```

The script checks Rust version, WASM target, Stellar CLI version, Node.js version,
and npm version, printing a pass/fail summary for each.

---

## Edge Cases

### Edge Case 1 — WASM Target Not Installed

**Symptom:** `error[E0463]: can't find crate for 'std'` during `cargo build`.

```bash
rustup target add wasm32-unknown-unknown
rustup target list --installed | grep wasm32
```

---

### Edge Case 2 — Stellar CLI Version / Rename

**Symptom:** `stellar: command not found` or unexpected argument errors.

The CLI was renamed from `soroban` to `stellar` in v20. Install the latest:

```bash
curl -Ls https://soroban.stellar.org/install-soroban.sh | sh
source ~/.bashrc
stellar --version
```

---

### Edge Case 3 — Testnet vs. Futurenet

Testnet is auto-funded via friendbot. Futurenet requires manual funding.

```bash
# Testnet
stellar keys generate --global alice --network testnet

# Futurenet
stellar network add futurenet \
  --rpc-url https://rpc-futurenet.stellar.org:443 \
  --network-passphrase "Test SDF Future Network ; October 2022"
```

---

### Edge Case 4 — Toolchain Drift After `rustup update`

After running `rustup update`, the WASM target may need to be re-added:

```bash
rustup update stable
rustup target add wasm32-unknown-unknown
cargo clean && cargo build --release --target wasm32-unknown-unknown
```

---

### Edge Case 5 — `cargo test` Hangs or Times Out

Soroban tests spin up an in-process ledger. On low-RAM machines, limit parallelism:

```bash
cargo test --workspace -- --test-threads=2
```

---

### Edge Case 6 — Node.js Version Mismatch

**Symptom:** `SyntaxError` or engine warning during `npm install`.

```bash
node --version   # must be >= 18
nvm install 18
nvm use 18
npm install
```

---

### Edge Case 7 — Peer Dependency Conflicts

**Symptom:** `npm ERR! peer dep missing` or resolution conflicts.

```bash
npm install --legacy-peer-deps
```

---

### Edge Case 8 — Port Conflict on Frontend Dev Server

**Symptom:** `EADDRINUSE: address already in use :::3000`

```bash
lsof -ti:3000 | xargs kill -9
npm run dev
```

---

### Edge Case 9 — CSS Variables Not Resolving

If CSS custom properties return empty strings at runtime, check:

1. The element is mounted in the DOM before reading variables.
2. Use `getComputedStyle` to read resolved values:

```ts
const value = getComputedStyle(document.documentElement)
  .getPropertyValue('--color-primary-blue')
  .trim();
```

3. Always provide a fallback value when using the `useDocsCssVariable` hook:

```ts
const color = useDocsCssVariable('--color-primary-blue', '#4f46e5');
```

4. SSR guard — the hook checks `typeof window` before accessing `getComputedStyle`:

```ts
if (typeof window === 'undefined') return fallback ?? '';
```

Use `CssVariableValidator` to validate variable names before access, preventing
CSS injection attacks.

---

## Security Notes

### Protect Secret Keys

> **Never commit `.soroban/` or `~/.config/stellar/` directories.**
> They contain plaintext secret keys. Add `.soroban/` to `.gitignore`.

- Rotate keys immediately if accidentally pushed to a public repository.
- Never embed secret keys in frontend error messages or logs.

### Mainnet Admin Governance

For mainnet deployments, use multisig or a governance contract for the admin role
rather than a single keypair. This prevents a single compromised key from upgrading
or draining the contract.

### CSS Injection Prevention

All CSS variable access must go through `CssVariableValidator` to prevent injection
attacks. The validator rejects variable names not in the approved list and blocks
dangerous CSS values (`url()`, `expression()`, `@import`).

---

## Related Docs

- [README.md](../README.md) — main setup guide
- [CONTRIBUTING.md](../CONTRIBUTING.md) — contribution guidelines
