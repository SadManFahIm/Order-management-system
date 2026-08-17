/**
 * Timezone helpers (Phase 5 follow-up) — resolve availability windows and
 * closure dates against a tenant's configured IANA timezone instead of the
 * server's local clock.
 *
 * No dependency: Node's built-in Intl.DateTimeFormat does the IANA lookup,
 * so any valid IANA timezone (e.g. 'Asia/Dhaka') works everywhere the
 * server runs. `timeZone` is always optional — callers that don't pass one
 * get the server-local behaviour (the historical default), so nothing
 * changes until a merchant configures a timezone.
 */

const DT_PARTS = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

/** Returns the wall-clock components of `date` in `timeZone` (or local). */
export function wallClock(date, timeZone) {
  if (!timeZone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      weekday: date.getDay(),
      hour: date.getHours(),
      minute: date.getMinutes(),
    };
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { ...DT_PARTS, timeZone })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  // Some environments render midnight as "24" with hour12:false.
  const hour = Number(parts.hour) % 24;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // (year, month, day) is the wall-clock date — its weekday is the
    // date's day-of-week regardless of timezone.
    weekday: new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))).getUTCDay(),
    hour,
    minute: Number(parts.minute),
  };
}

/** Local date → 'YYYY-MM-DD' in `timeZone` (or the server's local date). */
export function dateKeyIn(date, timeZone) {
  const c = wallClock(date, timeZone);
  return `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
}

/** Minutes-since-midnight of `date` in `timeZone` (0–1439). */
export function minutesOfDay(date, timeZone) {
  const c = wallClock(date, timeZone);
  return c.hour * 60 + c.minute;
}

/** The tz offset (minutes, UTC − wall clock) of an instant in `timeZone`. */
export function tzOffsetMinutes(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { ...DT_PARTS, timeZone })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  const hour = Number(parts.hour) % 24;
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute)
  );
  return Math.round((asUTC - date.getTime()) / 60000);
}

/**
 * Converts a wall-clock time (year, month 1-12, day, hour, minute) in
 * `timeZone` to the UTC instant. One probe iteration resolves the offset —
 * DST transition hours may be off by an hour, acceptable for scheduling
 * (and Bangladesh, the primary market, has no DST).
 */
export function wallToUtc({ year, month, day, hour, minute }, timeZone) {
  // No timezone ⇒ the wall clock IS the server's local clock, so build a
  // local Date (never Date.UTC — that would skew by the server offset).
  if (!timeZone) return new Date(year, month - 1, day, hour, minute);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offset = tzOffsetMinutes(new Date(guess), timeZone);
  return new Date(guess - offset * 60000);
}
