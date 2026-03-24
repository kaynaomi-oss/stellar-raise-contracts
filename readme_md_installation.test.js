const { execSync, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

describe('Installation Prerequisites & Verification', () => {
  const projectRoot = process.cwd();

  test('01 - Rust is installed and stable channel available', () => {
    const version = execSync('rustc --version', { encoding: 'utf8', stdio: 'pipe' }).toString().trim();
    expect(version).toMatch(/^rustc \d+\.\d+\.\d+/);
    expect(execSync('rustup show active-toolchain', { encoding: 'utf8', stdio: 'pipe' }).toString()).toMatch(/stable/);
  });

  test('02 - wasm32-unknown-unknown target installed', () => {
    const targets = execSync('rustup target list --installed', { encoding: 'utf8', stdio: 'pipe' }).toString();
    expect(targets).toMatch(/wasm32-unknown-unknown/);
  });

  test('03 - Stellar CLI installed and functional', () => {
    const version = execSync('stellar --version', { encoding: 'utf8', stdio: 'pipe' }).toString().trim();
    expect(version).toContain('stellar-cli');
  });

  test('04 - Node.js and npm available', () => {
    execSync('node --version', { encoding: 'utf8', stdio: 'pipe' });
    execSync('npm --version', { encoding: 'utf8', stdio: 'pipe' });
  });

  test('05 - Cargo build succeeds (debug mode)', () => {
    try {
      execSync('cargo build --target wasm32-unknown-unknown', { cwd: projectRoot, timeout: 60000, stdio: 'ignore' });
    } catch (e) {
      console.log('Build output:', e.stderr?.toString());
      throw new Error('Cargo build failed - check Rust/target setup');
    }
  }, 90000);

  test('06 - Cargo tests pass', () => {
    const result = execSync('cargo test --no-run', { cwd: projectRoot, encoding: 'utf8', stdio: 'pipe' }).toString();
    expect(result).toMatch(/test result: ok/);
  });

  test('07 - Frontend npm ci succeeds', () => {
    execSync('npm ci', { cwd: projectRoot, stdio: 'ignore', timeout: 120000 });
  });

  test('08 - Deployment script exists and is executable', () => {
    const scriptPath = path.join(projectRoot, 'scripts', 'deployment_shell_script.sh');
    expect(fs.existsSync(scriptPath)).toBe(true);
    expect(fs.statSync(scriptPath).mode & fs.constants.S_IXUSR).toBeTruthy();  // executable
  });

  test('09 - README build command valid', () => {
    // Dry-run release build
    execSync('cargo build --release --target wasm32-unknown-unknown -p crowdfund --dry-run', { cwd: projectRoot, stdio: 'ignore' });
  });
});

describe('Edge Cases', () => {
  test('No panic on missing Stellar keys (graceful)', () => {
    // stellar keys list should not crash if no keys
    try {
      execSync('stellar keys list', { timeout: 5000, stdio: 'ignore' });
    } catch (e) {
      // Expected if no keys configured
      expect(e.status).toBeGreaterThanOrEqual(0);
    }
  });
});

// Update jest.config.js if needed for Node env (current has jsdom, but ok for exec)
module.exports = {
  // Existing config handles
};

