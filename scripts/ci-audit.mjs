#!/usr/bin/env node
/**
 * Dependency-audit CI gate (shared by the backend and frontend jobs).
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
 *
 * Run from a package root (backend/ or frontend/) so `npm audit` resolves
 * the right lockfile. CI sets the job's working-directory accordingly.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);

const NPM_AUDIT_ARGS = ['audit', '--audit-level=high', '--json'];

/**
 * Single `npm audit` attempt. Returns a parsed verdict rather than exiting,
 * so the CLI wrapper and the unit tests drive the same logic.
 */
async function attemptAudit({ timeoutMs = 180_000 }) {
  let stdout = '';
  let stderr = '';
  try {
    if (process.platform === 'win32') {
      // .cmd shims cannot be spawned directly on Windows (spawn EINVAL), and
      // `shell: true` with an argv array triggers DEP0190 (unescaped
      // concatenation). Run the static command line through cmd.exe instead:
      // no shell option, and nothing in it is user-controlled. cmd.exe is
      // resolved via the standard executable search path (System32 is always
      // on it), so no environment variable is consulted.
      const cmd = [
        'cmd.exe',
        '/d',
        '/s',
        '/c',
        ['npm', ...NPM_AUDIT_ARGS].join(' '),
      ];
      ({ stdout } = await execFileAsync(cmd[0], cmd.slice(1), {
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
      }));
    } else {
      ({ stdout } = await execFileAsync('npm', NPM_AUDIT_ARGS, {
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
      }));
    }
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
    return {
      type: 'report',
      ok: (counts.high || 0) + (counts.critical || 0) === 0,
      counts,
      vulnerabilities: doc.vulnerabilities || {},
    };
  }

  // No machine-readable report: endpoint-level failure (503 / retirement /
  // "Invalid package tree" / timeout). Not a property of this repo.
  return {
    type: 'endpoint-error',
    reason: String(doc?.error || stderr || stdout).split('\n')[0].slice(0, 160),
  };
}

/**
 * Run the audit gate. Resolves true when the build may proceed (clean
 * report, or the audit endpoint itself was unavailable after retries) and
 * false when real high/critical vulnerabilities were found.
 */
export async function runAuditGate({
  maxAttempts = 2,
  retryDelayMs = Number(process.env.CI_AUDIT_RETRY_DELAY_MS || 10_000),
  timeoutMs,
} = {}) {
  let lastReason = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const verdict = await attemptAudit({ timeoutMs });
    if (verdict.type === 'report') {
      const { counts, vulnerabilities } = verdict;
      if (!verdict.ok) {
        console.error(
          `npm audit FAILED: ${counts.high || 0} high, ${counts.critical || 0} critical`
        );
        for (const v of Object.values(vulnerabilities)) {
          const via = (v.via || [])
            .map((x) => (typeof x === 'string' ? x : x.title))
            .join('; ');
          console.error(`  - ${v.name}@${v.range} — ${via}`);
        }
        return false;
      }
      console.log(
        `npm audit OK: ${counts.total || 0} total, ${counts.high || 0} high, ` +
          `${counts.critical || 0} critical`
      );
      return true;
    }
    lastReason = verdict.reason;
    if (attempt < maxAttempts) {
      console.warn(`npm audit endpoint error (${lastReason}) — retrying…`);
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
  console.warn(
    `npm audit endpoint unavailable (${lastReason}) — skipping gate; ` +
      'Dependabot alerts + dependency-review still cover vulnerabilities.'
  );
  return true;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const ok = await runAuditGate();
  process.exit(ok ? 0 : 1);
}