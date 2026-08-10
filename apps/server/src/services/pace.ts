import { and, gte, lt, eq, sql, inArray } from "drizzle-orm";
import { db } from "../db";
import { transactions, lineItems } from "../db/schema";
import { monthBounds, parseMonth } from "./month";
import { getBudget, occasionalCategoryIds, committedCategoryIds } from "./budget";

const DAY = 86400;

export type Pace = {
  month: string;
  /** Everything spent this month, whatever kind of spending it was. */
  spentMinor: number;
  /** Of the total: recurring commitments like rent. */
  committedMinor: number;
  /** Of the total: one-offs like a holiday, excluded from the living-cost average. */
  occasionalMinor: number;
  /** Of the total: what an ordinary month costs. The three sum to spentMinor. */
  livingMinor: number;
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

/** Sum of expense lines in a period that fall in one of the given categories. */
function linesIn(start: number, end: number, categoryIds: number[]): number {
  if (categoryIds.length === 0) return 0;
  const row = db
    .select({ total: sql<number | null>`sum(${lineItems.amountMinor})` })
    .from(lineItems)
    .innerJoin(transactions, eq(transactions.id, lineItems.transactionId))
    .where(
      and(
        eq(transactions.type, "expense"),
        gte(transactions.occurredOn, start),
        lt(transactions.occurredOn, end),
        inArray(lineItems.categoryId, categoryIds),
      ),
    )
    .get();
  return row?.total ?? 0;
}

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

  // The three parts are split at line level, not transaction level, so a receipt
  // covering both a holiday and groceries lands in both buckets.
  const occasional = occasionalCategoryIds();
  const committed = committedCategoryIds(month);
  const occasionalMinor = linesIn(start, end, occasional);
  const committedMinor = linesIn(start, end, committed);
  // Whatever is left is the ordinary cost of living. Derived by subtraction so the
  // three always add up to the total, even for a line in no bucket at all.
  const livingMinor = spentMinor - occasionalMinor - committedMinor;

  // Before the month: nothing elapsed. After it: all of it. Inside: whole days so far,
  // counting the current day as elapsed.
  const daysElapsed =
    today < start
      ? 0
      : today >= end
        ? daysInMonth
        : Math.min(Math.floor((today - start) / DAY) + 1, daysInMonth);

  // The daily rate measures ordinary living, not the total: a holiday paid for this
  // month would otherwise read as "you are spending 300 a day" for the rest of it.
  const perDayMinor = daysElapsed > 0 ? Math.round(livingMinor / daysElapsed) : null;

  return {
    month,
    spentMinor,
    committedMinor,
    occasionalMinor,
    livingMinor,
    daysElapsed,
    daysInMonth,
    daysRemaining: daysInMonth - daysElapsed,
    perDayMinor,
    projectedMinor: perDayMinor === null ? null : perDayMinor * daysInMonth,
    budgetMinor: getBudget(month).flexibleAverageMinor,
  };
}
