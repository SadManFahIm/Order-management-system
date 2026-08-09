/**
 * Starts the backend + frontend dev servers together — one command from the
 * repo root, zero dependencies:
 *
 *   npm run dev
 *
 * Backend  → http://localhost:4000   (nodemon, auto-restarts on change)
 * Frontend → http://localhost:5173   (Vite, proxies /api to :4000)
 *
 * Ctrl+C stops both. If either process exits, the other is stopped too so
 * the terminal never leaves a stray server running.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';

const children = [];
const start = (name, script, cwd, env) => {
  const child = spawn('npm', ['run', script], {
    cwd: join(root, cwd),
    stdio: 'inherit',
    shell: isWin, // npm is npm.cmd on Windows
    // Force the canonical ports — a stray PORT in the caller's environment
    // must never move the backend off :4000 (it reads process.env.PORT).
    env: { ...process.env, ...env },
  });
  children.push(child);
  child.on('exit', (code, signal) => {
    console.log(`\n[dev] ${name} exited (${signal || code}) — stopping the other servers.`);
    stopAll();
    process.exit(code ?? 0);
  });
  return child;
};

const stopAll = () => {
  for (const child of children) {
    if (child.exitCode === null && !child.killed) {
      if (isWin) {
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']);
      } else {
        child.kill('SIGTERM');
      }
    }
  }
};

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

start('backend', 'dev', 'backend', { PORT: '4000' });
start('frontend', 'dev', 'frontend', { PORT: '5173' });

console.log('[dev] Orderly dev servers starting…\n  backend  → http://localhost:4000\n  frontend → http://localhost:5173\n');
