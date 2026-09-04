import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

// backend/src/__tests__ -> repo root
const GATE = fileURLToPath(new URL('../../../scripts/ci-audit.mjs', import.meta.url));

/*
 * The gate resolves `npm` through PATH (cmd.exe /c on Windows, execFile on
 * POSIX), so every branch can be driven deterministically by putting a fake
 * `npm` shim ahead of the real one. The shim delegates to fake-npm.mjs,
 * which emits the exact stdout/exit shapes real npm emits for a controlled
 * AUDIT_MODE.
 */
const FAKE_NPM = `
// Test double for \`npm audit --json\`. Emits the stdout/exit shapes real npm
// emits so the gate's decision logic runs against controlled inputs.
const mode = process.env.AUDIT_MODE || 'clean';
if (mode === 'down') {
  console.error('npm ERR! code E503');
  console.error('npm ERR! 503 Service Unavailable - GET https://registry.npmjs.org/-/npm/v1/security/audits/quick');
  process.exit(1);
}
const clean = {
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 }, totalDependencies: 0 },
};
const high = {
  auditReportVersion: 2,
  vulnerabilities: {
    'fake-dep': {
      name: 'fake-dep', severity: 'high', isDirect: true,
      via: ['GHSA-fake-1234'], effects: [], range: '>=1.0.0 <1.0.1',
      nodes: ['node_modules/fake-dep'], fixAvailable: { name: 'fake-dep', version: '1.0.1', isSemVerMajor: false },
    },
  },
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 }, totalDependencies: 1 },
};
console.log(JSON.stringify(mode === 'high' ? high : clean));
process.exit(0);
`;

let fixtureDir;

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), 'ci-audit-'));
  await writeFile(join(fixtureDir, 'fake-npm.mjs'), FAKE_NPM, 'utf8');
  if (process.platform === 'win32') {
    // cmd.exe /c npm finds npm.cmd on PATH.
    await writeFile(join(fixtureDir, 'npm.cmd'), '@echo off\r\nnode "%~dp0fake-npm.mjs" %*\r\n', 'utf8');
  } else {
    await writeFile(
      join(fixtureDir, 'npm'),
      '#!/bin/sh\nexec node "$(dirname "$0")/fake-npm.mjs" "$@"\n',
      'utf8'
    );
    await chmod(join(fixtureDir, 'npm'), 0o755);
  }
});

afterAll(async () => {
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
});

function runGate(mode) {
  const env = {
    ...process.env,
    AUDIT_MODE: mode,
    // Keep the endpoint-down retry instant so the suite stays fast.
    CI_AUDIT_RETRY_DELAY_MS: '0',
    PATH: `${fixtureDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`,
  };
  return execFileAsync(process.execPath, [GATE], { env, timeout: 60_000 });
}

describe('ci-audit gate', () => {
  it('passes on a clean audit report', async () => {
    const { stdout, stderr } = await runGate('clean');
    expect(stdout).toContain('npm audit OK: 0 total, 0 high, 0 critical');
    expect(stderr).not.toContain('npm audit FAILED');
  });

  it('fails the build when the report contains high/critical findings', async () => {
    const result = await runGate('high').catch((err) => err);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('npm audit FAILED: 1 high, 0 critical');
    expect(result.stderr).toContain('fake-dep@>=1.0.0 <1.0.1 — GHSA-fake-1234');
  });

  it('warns and passes when the audit endpoint itself is unavailable', async () => {
    const { stderr } = await runGate('down');
    expect(stderr).toContain('npm audit endpoint error (npm ERR! code E503) — retrying…');
    expect(stderr).toContain('skipping gate');
  });
});