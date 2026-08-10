import { and, gte, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { transactions, lineItems } from "../db/schema";
import { resolvePeriod, type Period } from "./periods";
import { occasionalCategoryIds, committedCategoryIds } from "./budget";
import { parseMonth } from "./month";

export type SpendPart = { label: string; amountMinor: number };

export type PeriodSummary = {
  period: Period;
  /** Salary and anything else that came in. */
  incomeMinor: number;
  /**
   * Moved out to savings or investments.
   *
   * Only the amount matters here: the balances live in the broker's app and the
   * bank's, which know about interest and returns. This answers "how much did we
   * manage to put away", nothing more.
   */
  savedMinor: number;
  spentMinor: number;
  /** income − saved − spent. What is still available. */
  leftMinor: number;
  /** Of the spending: recurring commitments like rent. */
  committedMinor: number;
  /** Of the spending: one-offs like a holiday. */
  occasionalMinor: number;
  /** Of the spending: what ordinary living costs. The three sum to spentMinor. */
  livingMinor: number;
  committedParts: SpendPart[];
  occasionalParts: SpendPart[];
  livingParts: SpendPart[];
  daysElapsed: number;
  daysTotal: number;
  daysRemaining: number;
  /** Ordinary living per elapsed day. Null before the period starts. */
  perDayMinor: number | null;
  /** What is left divided across the days remaining. Null when nothing remains. */
  perDayLeftMinor: number | null;
};

const DAY = 86400;

/** Totals by transaction type within a window. */
function totalsByType(start: number, end: number): Map<string, number> {
  const rows = db
    .select({ type: transactions.type, total: sql<number>`sum(${transactions.totalMinor})` })
    .from(transactions)
    .where(and(gte(transactions.occurredOn, start), lt(transactions.occurredOn, end)))
    .groupBy(transactions.type)
    .all();
  return new Map(rows.map((r) => [r.type, r.total]));
}

/** Expense lines in a window, grouped by merchant, biggest first. */
function partsIn(start: number, end: number, categoryIds: number[] | null): SpendPart[] {
  const conditions = [
    sql`${transactions.type} = 'expense'`,
    gte(transactions.occurredOn, start),
    lt(transactions.occurredOn, end),
  ];
  if (categoryIds !== null) {
    if (categoryIds.length === 0) return [];
    conditions.push(sql`${lineItems.categoryId} in ${categoryIds}`);
  }

  return db
    .select({
      label: sql<string>`coalesce(${transactions.merchantRaw}, 'Без названия')`,
      amountMinor: sql<number>`sum(${lineItems.amountMinor})`,
    })
    .from(lineItems)
    .innerJoin(transactions, sql`${transactions.id} = ${lineItems.transactionId}`)
    .where(and(...conditions))
    .groupBy(sql`coalesce(${transactions.merchantRaw}, 'Без названия')`)
    .all()
    .sort((a, b) => b.amountMinor - a.amountMinor);
}

/** Sum of expense lines in a window falling in the given categories. */
function linesIn(start: number, end: number, categoryIds: number[]): number {
  if (categoryIds.length === 0) return 0;
  const row = db
    .select({ total: sql<number | null>`sum(${lineItems.amountMinor})` })
    .from(lineItems)
    .innerJoin(transactions, sql`${transactions.id} = ${lineItems.transactionId}`)
    .where(
      and(
        sql`${transactions.type} = 'expense'`,
        gte(transactions.occurredOn, start),
        lt(transactions.occurredOn, end),
        sql`${lineItems.categoryId} in ${categoryIds}`,
      ),
    )
    .get();
  return row?.total ?? 0;
}

/**
 * Everything the dashboard reports, over either a calendar month or a pay period.
 *
 * The pay period is the one that matches how the money actually moves: salary lands,
 * savings go out the same day, the rest has to last until the next one. Reported over
 * a calendar month those three fall in different buckets and the arithmetic reads as
 * a deficit that is not real.
 */
export function getPeriodSummary(
  periodId: string,
  now: number = Math.floor(Date.now() / 1000),
): PeriodSummary {
  const period = resolvePeriod(periodId, now);
  const { start, end } = period;

  const totals = totalsByType(start, end);
  const incomeMinor = totals.get("income") ?? 0;
  const savedMinor = totals.get("transfer") ?? 0;
  const spentMinor = totals.get("expense") ?? 0;

  // Commitments are declared per month; a pay period spans at most two, so the month
  // its start falls in is the one whose commitments apply.
  const startMonth = new Date(start * 1000).toISOString().slice(0, 7);
  parseMonth(startMonth);

  const occasional = occasionalCategoryIds();
  const committed = committedCategoryIds(startMonth);

  const occasionalMinor = linesIn(start, end, occasional);
  const committedMinor = linesIn(start, end, committed);
  const livingMinor = spentMinor - occasionalMinor - committedMinor;

  const committedParts = partsIn(start, end, committed);
  const occasionalParts = partsIn(start, end, occasional);

  const claimed = new Map<string, number>();
  for (const part of [...committedParts, ...occasionalParts]) {
    claimed.set(part.label, (claimed.get(part.label) ?? 0) + part.amountMinor);
  }
  const livingParts = partsIn(start, end, null)
    .map((p) => ({ ...p, amountMinor: p.amountMinor - (claimed.get(p.label) ?? 0) }))
    .filter((p) => p.amountMinor > 0)
    .sort((a, b) => b.amountMinor - a.amountMinor);

  // An open pay period runs to "now", so its actual length says nothing about how
  // long the money has to last. The expected length does.
  const daysTotal = Math.max(period.expectedDays, 1);
  const elapsedRaw = now < start ? 0 : Math.floor((now - start) / DAY) + 1;
  const daysElapsed = Math.min(elapsedRaw, daysTotal);
  const daysRemaining = daysTotal - daysElapsed;

  return {
    period,
    incomeMinor,
    savedMinor,
    spentMinor,
    leftMinor: incomeMinor - savedMinor - spentMinor,
    committedMinor,
    occasionalMinor,
    livingMinor,
    committedParts,
    occasionalParts,
    livingParts,
    daysElapsed,
    daysTotal,
    daysRemaining,
    // Measured against ordinary living, not the total: a holiday paid inside this
    // period would otherwise read as a daily habit.
    perDayMinor: daysElapsed > 0 ? Math.round(livingMinor / daysElapsed) : null,
    // What is left has to cover the days still to come — the figure that answers
    // "can we order sushi tonight".
    perDayLeftMinor:
      daysRemaining > 0 && incomeMinor > 0
        ? Math.round((incomeMinor - savedMinor - spentMinor) / daysRemaining)
        : null,
  };
}
