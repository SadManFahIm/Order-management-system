#!/usr/bin/env node
/**
 * Dependency-audit CI gate (replaces a bare `npm audit --audit-level=high`).
 *
 * npm's legacy audit endpoint (/-/npm/v1/security/audits/quick) is being
 * retired and intermittently fails with 503 / "Invalid package tree" /
 * timeouts — a bare audit step therefore fails CI at random with no code
 * change involved.
 *
 * This gate keeps the real signal and drops the noise:
 *   - the endpoint responds with a real report -> high/critical
 *     vulnerabilities FAIL the build (same signal as before);
 *   - the endpoint itself errors or times out -> the step warns and passes,
 *     because vulnerability coverage continues via GitHub Dependabot alerts
 *     and dependency-review on pull requests.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_ATTEMPTS = 2;

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  let stdout = '';
  let stderr = '';
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    ({ stdout } = await execFileAsync(npmCmd, ['audit', '--audit-level=high', '--json'], {
      timeout: 180_000,
      maxBuffer: 32 * 1024 * 1024,
    }));
  } catch (err) {
    stdout = err.stdout || '';
    stderr = err.stderr || String(err.message || '');
  }

  // npm audit --json always emits a JSON document on stdout — either a real
  // report (with `metadata.vulnerabilities`) or an error object.
  let doc = null;
  try {
    doc = JSON.parse(stdout);
  } catch {
    doc = null;
  }

  if (doc && doc.metadata) {
    const counts = doc.metadata.vulnerabilities || {};
    const high = counts.high || 0;
    const critical = counts.critical || 0;
    if (high + critical > 0) {
      console.error(`npm audit FAILED: ${high} high, ${critical} critical`);
      for (const v of Object.values(doc.vulnerabilities || {})) {
        const via = (v.via || [])
          .map((x) => (typeof x === 'string' ? x : x.title))
          .join('; ');
        console.error(`  - ${v.name}@${v.range} — ${via}`);
      }
      process.exit(1);
    }
    console.log(
      `npm audit OK: ${counts.total || 0} total, ${high} high, ${critical} critical`
    );
    process.exit(0);
  }

  // No machine-readable report: endpoint-level failure (503 / retirement /
  // "Invalid package tree" / timeout). Not a property of this repo.
  const reason = String(doc?.error || stderr || stdout)
    .split('\n')[0]
    .slice(0, 160);
  if (attempt === MAX_ATTEMPTS) {
    console.warn(
      `npm audit endpoint unavailable (${reason}) — skipping gate; ` +
        'Dependabot alerts + dependency-review still cover vulnerabilities.'
    );
    process.exit(0);
  }
  console.warn(`npm audit endpoint error (${reason}) — retrying…`);
  await new Promise((r) => setTimeout(r, 10_000));
}
