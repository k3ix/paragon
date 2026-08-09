/**
 * "YYYY-MM" handling, shared by every service that filters by month.
 *
 * Kept in one place because the range check is easy to omit and the failure is
 * silent: Date.UTC rolls month 13 over into January of the next year, so an
 * unchecked "2026-13" returns a different month's figures instead of an error.
 */

export function parseMonth(month: string): { year: number; m: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month.trim());
  if (!match) throw new Error(`Invalid month, expected YYYY-MM: ${month}`);
  const year = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12) throw new Error(`Invalid month number, expected 01-12: ${month}`);
  return { year, m };
}

/** Unix-second bounds of a month, half-open: [start, end). */
export function monthBounds(month: string): { start: number; end: number } {
  const { year, m } = parseMonth(month);
  return {
    start: Math.floor(Date.UTC(year, m - 1, 1) / 1000),
    end: Math.floor(Date.UTC(m === 12 ? year + 1 : year, m === 12 ? 0 : m, 1) / 1000),
  };
}

/** Shifts a month by a signed number of months. */
export function shiftMonth(month: string, delta: number): string {
  const { year, m } = parseMonth(month);
  const total = year * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}
