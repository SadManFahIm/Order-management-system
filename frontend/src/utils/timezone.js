/**
 * Client-side timezone helpers (Phase 4 follow-up round 7) — mirror the
 * backend's `backend/src/utils/timezone.js` so the storefront can convert a
 * restaurant's wall-clock availability (expressed in the restaurant's IANA
 * zone) into the customer's own browser timezone. Intl-based, no dependency.
 */

/** Returns the wall-clock components of `date` in `timeZone` (or local). */
export function wallClock(date, timeZone) {
  if (!timeZone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
    };
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  // Some environments render midnight as "24" with hour12:false.
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

/** 'YYYY-MM-DD' string (in `timeZone`, or local) for an instant. */
export function dateKeyIn(date, timeZone) {
  const c = wallClock(date, timeZone);
  return `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
}

/** The tz offset (minutes, UTC − wall clock) of an instant in `timeZone`. */
export function tzOffsetMinutes(date, timeZone) {
  const c = wallClock(date, timeZone);
  const asUTC = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute);
  return Math.round((asUTC - date.getTime()) / 60000);
}

/**
 * Wall-clock components in `timeZone` → UTC instant. One probe iteration
 * resolves the offset (DST-transition hours may be off by one — acceptable
 * for scheduling, and Bangladesh has no DST).
 */
export function wallToUtc({ year, month, day, hour, minute }, timeZone) {
  if (!timeZone) return new Date(year, month - 1, day, hour, minute);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offset = tzOffsetMinutes(new Date(guess), timeZone);
  return new Date(guess - offset * 60000);
}

/** 'HH:MM' string → minutes since midnight. */
const toMinutes = (hhmm) => {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

/**
 * The window segments a dish is orderable on restaurant day `date`
 * (expressed in `restaurantTz`), converted to absolute [fromUtc, toUtc)
 * instants. Overnight windows are already split by the API (22:00→24:00 +
 * 00:00→04:00), so each segment maps to one UTC range.
 */
export function windowsToUtcSegments(date, windows, restaurantTz) {
  if (!windows || windows.length === 0) return [];
  return windows
    .map((w) => {
      const from = toMinutes(w.from);
      const to = toMinutes(w.to);
      if (from === null || to === null) return null;
      const startUtc = wallToUtc(
        {
          year: Number(date.slice(0, 4)),
          month: Number(date.slice(5, 7)),
          day: Number(date.slice(8, 10)),
          hour: Math.floor(from / 60),
          minute: from % 60,
        },
        restaurantTz
      );
      // '24:00' means end-of-day (start of the next day).
      const endUtc =
        to === 1440
          ? wallToUtc(
              {
                year: Number(date.slice(0, 4)),
                month: Number(date.slice(5, 7)),
                day: Number(date.slice(8, 10)) + 1,
                hour: 0,
                minute: 0,
              },
              restaurantTz
            )
          : wallToUtc(
              {
                year: Number(date.slice(0, 4)),
                month: Number(date.slice(5, 7)),
                day: Number(date.slice(8, 10)),
                hour: Math.floor(to / 60),
                minute: to % 60,
              },
              restaurantTz
            );
      return { fromUtc: startUtc.getTime(), toUtc: endUtc.getTime() };
    })
    .filter(Boolean);
}

/**
 * Maps a set of UTC open segments onto a 24-hour grid of the customer's own
 * browser day `browserDate` ('YYYY-MM-DD', browser-local). Returns 24
 * booleans (index = browser hour). A browser hour is open when its UTC
 * instant falls inside any open segment.
 */
export function browserDaySlots(browserDate, utcSegments, browserTz) {
  const year = Number(browserDate.slice(0, 4));
  const month = Number(browserDate.slice(5, 7));
  const day = Number(browserDate.slice(8, 10));
  return Array.from({ length: 24 }, (_, h) => {
    const at = wallToUtc({ year, month, day, hour: h, minute: 0 }, browserTz).getTime();
    return utcSegments.some((s) => at >= s.fromUtc && at < s.toUtc);
  });
}

/** The browser's own IANA zone (falls back to null when unavailable). */
export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
