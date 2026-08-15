/**
 * Tiny structured logger (Phase 1 foundation).
 *
 * One line per log entry, carrying a `requestId` when one is passed so a
 * request's logs can be correlated end-to-end (the request middleware stamps
 * every request with a UUID echoed in `X-Request-Id`).
 *
 *   - production: one JSON object per line — ready for log shipping /
 *     parsers (Datadog, Loki, CloudWatch, …).
 *   - dev/test: readable lines with the same fields.
 *
 * No dependencies by design — the whole module is ~30 lines.
 */
const isProd = process.env.NODE_ENV === 'production';

function format(level, msg, meta) {
  const ts = new Date().toISOString();
  if (isProd) {
    return JSON.stringify({ ts, level, msg, ...meta });
  }
  const extra = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `[${ts}] ${level.toUpperCase()} ${msg}${extra}`;
}

function write(level, msg, meta) {
  const line = format(level, msg, meta);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
};
