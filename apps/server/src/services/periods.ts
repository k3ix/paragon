import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { transactions } from "../db/schema";
import { monthBounds, parseMonth } from "./month";

/**
 * A stretch of time the figures are reported over.
 *
 * Two kinds exist because they answer different questions. A calendar month answers
 * "what did August cost". A pay period answers "how are we doing on this paycheque",
 * which is the question behind setting money aside on payday and living on the rest.
 */
export type Period = {
  kind: "month" | "pay";
  /** Stable identifier: "2026-08" for a month, the start date for a pay period. */
  id: string;
  label: string;
  /** Unix seconds, half-open: [start, end). */
  start: number;
  end: number;
  /** True while the period is still running, so figures in it are partial. */
  open: boolean;
  /**
   * How long the period is expected to run, in days.
   *
   * For a closed period this is its actual length. For the open one the next payday
   * is unknown, so it is estimated from previous periods — otherwise "what is left
   * per day" would be unanswerable on payday itself, which is exactly when it is
   * asked.
   */
  expectedDays: number;
};

const DAY = 86400;

/**
 * A pay period's identifier: "pay-2026-08-10".
 *
 * Prefixed because Eden Treaty parses any bare ISO date string in a response into a
 * Date object on the client, and the id has to survive the trip as a string.
 */
function payId(seconds: number): string {
  return `pay-${new Date(seconds * 1000).toISOString().slice(0, 10)}`;
}

/** "10 авг." from Unix seconds. */
function shortDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function monthPeriod(month: string, now: number): Period {
  parseMonth(month);
  const { start, end } = monthBounds(month);
  return {
    kind: "month",
    id: month,
    label: new Date(start * 1000).toLocaleDateString("ru-RU", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
    start,
    end,
    open: now < end,
    expectedDays: Math.round((end - start) / DAY),
  };
}

/**
 * Pay periods, newest first: each runs from one salary to the day before the next.
 *
 * Boundaries come from recorded income rather than a configured payday, because the
 * date moves — the tenth one month, the fifth the next. The most recent period runs
 * to now and is marked open, since its figures are still accumulating.
 *
 * Salary arrives as a single transaction, so consecutive income rows are genuinely
 * separate paycheques and need no grouping.
 */
export function payPeriods(now: number = Math.floor(Date.now() / 1000)): Period[] {
  const incomes = db
    .select({ occurredOn: transactions.occurredOn })
    .from(transactions)
    .where(eq(transactions.type, "income"))
    .orderBy(asc(transactions.occurredOn))
    .all();

  if (incomes.length === 0) return [];

  // Closed periods have a real length; the open one borrows their average so the
  // "per day remaining" figure exists on payday, before the next date is known.
  //
  // Only periods of at least three weeks count towards that average. A salary
  // back-dated to balance the books, or a one-off correction, produces a short period
  // that would otherwise drag the estimate down and claim the money must last ten
  // days when it has to last a month.
  const MIN_TYPICAL_DAYS = 21;
  const closedLengths: number[] = [];
  for (let i = 0; i + 1 < incomes.length; i++) {
    const days = Math.round((incomes[i + 1]!.occurredOn - incomes[i]!.occurredOn) / DAY);
    if (days >= MIN_TYPICAL_DAYS) closedLengths.push(days);
  }
  const typicalDays =
    closedLengths.length > 0
      ? Math.round(closedLengths.reduce((a, b) => a + b, 0) / closedLengths.length)
      : 30;

  const periods: Period[] = [];
  for (let i = 0; i < incomes.length; i++) {
    const start = incomes[i]!.occurredOn;
    const next = incomes[i + 1]?.occurredOn;
    // The last period has no following salary yet, so it runs to now — or at least a
    // day, so a paycheque recorded today is not an empty range.
    const end = next ?? Math.max(now, start + DAY);

    periods.push({
      kind: "pay",
      id: payId(start),
      label:
        next === undefined
          ? `с ${shortDate(start)}`
          : `${shortDate(start)} — ${shortDate(next - DAY)}`,
      start,
      end,
      open: next === undefined,
      expectedDays: next === undefined ? typicalDays : Math.round((end - start) / DAY),
    });
  }

  return periods.reverse();
}

/** The pay period covering a moment, or the most recent one before it. */
export function payPeriodAt(when: number, now: number = Math.floor(Date.now() / 1000)): Period | null {
  const periods = payPeriods(now);
  return periods.find((p) => when >= p.start && when < p.end) ?? periods[0] ?? null;
}

/** Resolves a period id — "2026-08" or "2026-08-10" — to its bounds. */
export function resolvePeriod(
  id: string,
  now: number = Math.floor(Date.now() / 1000),
): Period {
  if (/^\d{4}-\d{2}$/.test(id)) return monthPeriod(id, now);

  if (/^pay-\d{4}-\d{2}-\d{2}$/.test(id)) {
    const match = payPeriods(now).find((p) => p.id === id);
    if (match) return match;
    throw new Error(`No pay period starts on ${id.slice(4)}`);
  }

  throw new Error(`Invalid period, expected YYYY-MM or pay-YYYY-MM-DD: ${id}`);
}
