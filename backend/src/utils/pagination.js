/**
 * Parses and clamps `limit` / `offset` query parameters so list endpoints are
 * bounded. Returns defaults when absent and caps the page size to protect
 * memory and response time.
 */
export function parsePagination(query, { defaultLimit = 50, maxLimit = 200 } = {}) {
  const limit = Math.min(
    Math.max(Number.parseInt(query.limit, 10) || defaultLimit, 1),
    maxLimit
  );
  const offset = Math.max(Number.parseInt(query.offset, 10) || 0, 0);
  return { limit, offset };
}
