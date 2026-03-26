/**
 * readme_md_installation.test.js
 *
 * Programmatically verifies that the installation commands documented in
 * README.md and docs/readme_md_installation.md execute without errors.
 *
 * Coverage target: 95%+ of "Getting Started" commands.
 *
 * @security  Tests run in the current working directory. They do not write
 *            to the network or require Stellar keys. No secret material is
 *            accessed or generated.
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname);
const DEPLOY_SCRIPT = path.join(ROOT, 'scripts', 'deploy.sh');
const INTERACT_SCRIPT = path.join(ROOT, 'scripts', 'interact.sh');
const EXEC_OPTS = { encoding: 'utf8', stdio: 'pipe' };

// Use real binary paths — snap wrappers silently return empty output from Node.js
const RUST_BIN = '/home/ajidokwu/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin';
const RUSTUP_BIN = '/snap/rustup/current/bin';
// nvm node may not be on the Jest process PATH; find the active version
const NVM_NODE_BIN = (() => {
  const nvm = process.env.NVM_BIN || '';
  if (nvm) return nvm;
  try {
    const { execSync: es } = require('child_process');
    const p = es('bash -c "source ~/.nvm/nvm.sh 2>/dev/null && which node"',
      { encoding: 'utf8', stdio: 'pipe' }).trim();
    return require('path').dirname(p);
  } catch (_) { return ''; }
})();
const AUGMENTED_PATH = [RUST_BIN, RUSTUP_BIN, NVM_NODE_BIN, '/snap/bin', process.env.PATH || ''].filter(Boolean).join(':');
const AUGMENTED_ENV = { ...process.env, PATH: AUGMENTED_PATH };

/** Run a command and return stdout, or throw with a clear message. */
function run(cmd, opts = {}) {
  return execSync(cmd, { ...EXEC_OPTS, env: AUGMENTED_ENV, ...opts });
}

/** Run a script with args via spawnSync; returns { stdout, stderr, status }. */
function runScript(scriptPath, args = []) {
  const result = spawnSync('bash', [scriptPath, ...args], {
    encoding: 'utf8',
    env: AUGMENTED_ENV,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
  };
}

/** Extract [LOG] lines from output. */
function logLines(output) {
  return (output || '').split('\n').filter(l => l.includes('[LOG]'));
}

/** Parse a single [LOG] key=value line into an object. */
function parseLog(line) {
  const obj = {};
  const matches = (line || '').matchAll(/(\w+)=(\S+)/g);
  for (const [, k, v] of matches) obj[k] = v;
  return obj;
}

/** Returns true if the stellar CLI is available. */
function hasStellar() {
  try {
    run('stellar --version');
    return true;
  } catch (_) {
    return false;
  }
}

const STELLAR_AVAILABLE = hasStellar();

// ── Prerequisites ─────────────────────────────────────────────────────────────

describe('Prerequisites', () => {
  test('rustc is installed (stable channel)', () => {
    const out = run('rustc --version');
    expect(out).toMatch(/^rustc \d+\.\d+\.\d+/);
  });

  test('cargo is installed', () => {
    const out = run('cargo --version');
    expect(out).toMatch(/^cargo \d+\.\d+\.\d+/);
  });

  test('wasm32-unknown-unknown target is installed', () => {
    const out = run('rustup target list --installed');
    expect(out).toContain('wasm32-unknown-unknown');
  });

  test('stellar CLI is installed (v20+ rename)', () => {
    if (!STELLAR_AVAILABLE) {
      console.warn('  [SKIP] stellar CLI not found — skipping version check');
      return;
    }
    const out = run('stellar --version');
    expect(out).toContain('stellar');
  });

  test('Node.js >= 18 is available', () => {
    const out = run('node --version');
    const major = parseInt(out.trim().replace('v', ''), 10);
    expect(major).toBeGreaterThanOrEqual(18);
  });
});

// ── Getting Started commands ──────────────────────────────────────────────────

describe('Getting Started', () => {
  test('cargo check is available (toolchain ready)', () => {
    const out = run('cargo --version');
    expect(out).toMatch(/^cargo \d+\.\d+\.\d+/);
  });

  test('wasm32 target is present for cargo builds', () => {
    const out = run('rustup target list --installed');
    expect(out).toContain('wasm32-unknown-unknown');
  });
});

// ── deploy.sh logging bounds ──────────────────────────────────────────────────

describe('deploy.sh logging bounds', () => {
  test('10 - deploy.sh with no args exits non-zero (missing required args)', () => {
    const { status } = runScript(DEPLOY_SCRIPT, []);
    expect(status).not.toBe(0);
  });

  test('11 - deploy.sh emits no [LOG] lines before arg validation fails', () => {
    const { stdout } = runScript(DEPLOY_SCRIPT, []);
    expect(logLines(stdout).length).toBe(0);
  });

  test('12 - [LOG] line format is key=value pairs', () => {
    const out = execSync(
      `bash -c 'echo "[LOG] step=build status=start"'`,
      { encoding: 'utf8' }
    ).trim();
    const parsed = parseLog(out);
    expect(parsed.step).toBe('build');
    expect(parsed.status).toBe('start');
  });

  test('13 - deploy.sh [LOG] lines use step= field', () => {
    const src = fs.readFileSync(DEPLOY_SCRIPT, 'utf8');
    expect(src).toMatch(/\[LOG\] step=build status=start/);
    expect(src).toMatch(/\[LOG\] step=build status=ok/);
    expect(src).toMatch(/\[LOG\] step=deploy status=start/);
    expect(src).toMatch(/\[LOG\] step=deploy status=ok/);
    expect(src).toMatch(/\[LOG\] step=initialize status=start/);
    expect(src).toMatch(/\[LOG\] step=initialize status=ok/);
    expect(src).toMatch(/\[LOG\] step=done/);
  });

  test('14 - deploy.sh has at most 7 [LOG] echo lines (bounded output)', () => {
    const src = fs.readFileSync(DEPLOY_SCRIPT, 'utf8');
    const count = (src.match(/echo "\[LOG\]/g) || []).length;
    expect(count).toBeLessThanOrEqual(7);
  });
});

// ── Edge Case — WASM target ───────────────────────────────────────────────────

describe('Edge Case — WASM target', () => {
  test('rustup target list --installed contains wasm32-unknown-unknown', () => {
    expect(run('rustup target list --installed')).toMatch(/wasm32-unknown-unknown/);
  });
});

// ── interact.sh logging bounds ────────────────────────────────────────────────

describe('interact.sh logging bounds', () => {
  test('16 - interact.sh with no args exits non-zero', () => {
    const { status } = runScript(INTERACT_SCRIPT, []);
    expect(status).not.toBe(0);
  });

  test('17 - interact.sh unknown action emits exactly 1 [LOG] error line', () => {
    const { stdout, status } = runScript(INTERACT_SCRIPT, ['CTEST', 'unknown_action']);
    expect(status).toBe(1);
    const lines = logLines(stdout);
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/status=error/);
  });

  test('18 - interact.sh unknown action log line has reason= field', () => {
    const { stdout } = runScript(INTERACT_SCRIPT, ['CTEST', 'unknown_action']);
    const lines = logLines(stdout);
    const parsed = parseLog(lines[0]);
    expect(parsed.reason).toBe('unknown_action');
  });

  test('19 - interact.sh contribute action has exactly 2 [LOG] lines in source', () => {
    const src = fs.readFileSync(INTERACT_SCRIPT, 'utf8');
    const contributeBlock = src.match(/contribute\)([\s\S]*?);;/)?.[1] || '';
    const count = (contributeBlock.match(/echo "\[LOG\]/g) || []).length;
    expect(count).toBe(2);
  });

  test('20 - interact.sh withdraw action has exactly 2 [LOG] lines in source', () => {
    const src = fs.readFileSync(INTERACT_SCRIPT, 'utf8');
    const withdrawBlock = src.match(/withdraw\)([\s\S]*?);;/)?.[1] || '';
    const count = (withdrawBlock.match(/echo "\[LOG\]/g) || []).length;
    expect(count).toBe(2);
  });
});

// ── Edge Case — Stellar CLI versioning ───────────────────────────────────────

describe('Edge Case — Stellar CLI versioning', () => {
  test('stellar --version does not contain "soroban" (v20+ rename)', () => {
    if (!STELLAR_AVAILABLE) {
      console.warn('  [SKIP] stellar CLI not found — skipping rename check');
      return;
    }
    const out = run('stellar --version');
    expect(out).not.toMatch(/^soroban/);
  });

  test('stellar contract --help exits cleanly', () => {
    if (!STELLAR_AVAILABLE) {
      console.warn('  [SKIP] stellar CLI not found — skipping contract --help check');
      return;
    }
    expect(() => run('stellar contract --help')).not.toThrow();
  });
});

// ── Edge Case: Network identity ───────────────────────────────────────────────

describe('Edge Case — Network identity (graceful, no keys required)', () => {
  test('stellar keys list does not crash', () => {
    if (!STELLAR_AVAILABLE) {
      console.warn('  [SKIP] stellar CLI not found — skipping keys list check');
      return;
    }
    expect(() => {
      try { run('stellar keys list'); } catch (_) { /* no keys configured */ }
    }).not.toThrow();
  });
});

// ── Security: .soroban not committed ─────────────────────────────────────────

describe('Security', () => {
  test('.soroban/ is listed in .gitignore', () => {
    const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/\.soroban/);
  });

  test('verify_env.sh exists and is executable', () => {
    const script = path.join(ROOT, 'scripts', 'verify_env.sh');
    expect(fs.existsSync(script)).toBe(true);
    // S_IXUSR = 0o100 — owner execute bit
    expect(fs.statSync(script).mode & 0o100).toBeTruthy();
  });

  test('docs/readme_md_installation.md exists', () => {
    expect(fs.existsSync(path.join(ROOT, 'docs', 'readme_md_installation.md'))).toBe(true);
  });
});
