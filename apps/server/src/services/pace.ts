import { and, gte, lt, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { transactions } from "../db/schema";
import { monthBounds, parseMonth } from "./month";
import { getBudget } from "./budget";

const DAY = 86400;

export type Pace = {
  month: string;
  spentMinor: number;
  daysElapsed: number;
  daysInMonth: number;
  daysRemaining: number;
  /** Average spend per elapsed day. Null before the month begins. */
  perDayMinor: number | null;
  /** Current pace extended across the whole month. Null before it begins. */
  projectedMinor: number | null;
  /** The flexible-spending budget this month is measured against, when known. */
  budgetMinor: number | null;
};

/**
 * How the month is going so far.
 *
 * `today` is a parameter rather than a call to the clock so the behaviour is
 * testable — every branch here depends on where "now" falls relative to the month.
 */
export function getPace(month: string, today: number = Math.floor(Date.now() / 1000)): Pace {
  parseMonth(month);
  const { start, end } = monthBounds(month);
  const daysInMonth = Math.round((end - start) / DAY);

  const row = db
    .select({ total: sql<number | null>`sum(${transactions.totalMinor})` })
    .from(transactions)
    .where(
      and(
        eq(transactions.type, "expense"),
        gte(transactions.occurredOn, start),
        lt(transactions.occurredOn, end),
      ),
    )
    .get();
  const spentMinor = row?.total ?? 0;

  // Before the month: nothing elapsed. After it: all of it. Inside: whole days so far,
  // counting the current day as elapsed.
  const daysElapsed =
    today < start
      ? 0
      : today >= end
        ? daysInMonth
        : Math.min(Math.floor((today - start) / DAY) + 1, daysInMonth);

  const perDayMinor = daysElapsed > 0 ? Math.round(spentMinor / daysElapsed) : null;

  return {
    month,
    spentMinor,
    daysElapsed,
    daysInMonth,
    daysRemaining: daysInMonth - daysElapsed,
    perDayMinor,
    projectedMinor: perDayMinor === null ? null : perDayMinor * daysInMonth,
    budgetMinor: getBudget(month).flexibleAverageMinor,
  };
}
