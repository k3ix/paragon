import { and, gte, lt, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { transactions, lineItems, categories } from "../db/schema";
import { monthBounds, parseMonth, shiftMonth } from "./month";
import { getBudget } from "./budget";

export type SavingsDestination = {
  /** Category path, or the merchant when a transfer carries no category. */
  label: string;
  amountMinor: number;
};

export type Savings = {
  month: string;
  /** Everything moved out of spending accounts this month. */
  savedMinor: number;
  /** Where it went, biggest first. */
  destinations: SavingsDestination[];
  /** Income recorded this month, whatever actually arrived. */
  incomeMinor: number;
  /** savedMinor as a share of income, rounded. Null when no income is recorded. */
  rate: number | null;
  /** The same figure for the previous month, for a one-glance comparison. */
  previousMinor: number;
  /** Months back to the start of records, capped, for the sparkline. */
  history: { month: string; savedMinor: number }[];
};

/** How many months of history the screen shows behind the current one. */
const HISTORY_MONTHS = 6;

/**
 * Money moved into savings during a month.
 *
 * Transfers, not expenses: the money still belongs to the household, so counting it
 * as spending would make a good month look like a blowout. It is tracked separately
 * because "how much did we actually put away" is the question the whole app exists
 * to answer, and it cannot be read off a spending total.
 */
function savedInMonth(month: string): number {
  const { start, end } = monthBounds(month);
  const row = db
    .select({ total: sql<number | null>`sum(${transactions.totalMinor})` })
    .from(transactions)
    .where(
      and(
        eq(transactions.type, "transfer"),
        gte(transactions.occurredOn, start),
        lt(transactions.occurredOn, end),
      ),
    )
    .get();
  return row?.total ?? 0;
}

export function getSavings(month: string): Savings {
  parseMonth(month);
  const { start, end } = monthBounds(month);

  const savedMinor = savedInMonth(month);

  const rows = db
    .select({
      categoryId: lineItems.categoryId,
      categoryName: categories.name,
      merchant: transactions.merchantRaw,
      amountMinor: lineItems.amountMinor,
    })
    .from(lineItems)
    .innerJoin(transactions, eq(transactions.id, lineItems.transactionId))
    .leftJoin(categories, eq(categories.id, lineItems.categoryId))
    .where(
      and(
        eq(transactions.type, "transfer"),
        gte(transactions.occurredOn, start),
        lt(transactions.occurredOn, end),
      ),
    )
    .all();

  // Grouped by destination rather than by transfer: two payments into the same
  // account in one month are one decision, not two.
  const byLabel = new Map<string, number>();
  for (const row of rows) {
    const label = row.categoryName ?? row.merchant ?? "Без назначения";
    byLabel.set(label, (byLabel.get(label) ?? 0) + row.amountMinor);
  }

  const destinations = [...byLabel.entries()]
    .map(([label, amountMinor]) => ({ label, amountMinor }))
    .sort((a, b) => b.amountMinor - a.amountMinor);

  const incomeRow = db
    .select({ total: sql<number | null>`sum(${transactions.totalMinor})` })
    .from(transactions)
    .where(
      and(
        eq(transactions.type, "income"),
        gte(transactions.occurredOn, start),
        lt(transactions.occurredOn, end),
      ),
    )
    .get();
  const incomeMinor = incomeRow?.total ?? 0;

  const history: { month: string; savedMinor: number }[] = [];
  for (let i = HISTORY_MONTHS - 1; i >= 0; i--) {
    const past = shiftMonth(month, -i);
    history.push({ month: past, savedMinor: savedInMonth(past) });
  }

  return {
    month,
    savedMinor,
    destinations,
    incomeMinor,
    // Against actual income rather than the declared base: this reports what happened,
    // not what was planned. The plan lives in getBudget.
    rate: incomeMinor === 0 ? null : Math.round((savedMinor / incomeMinor) * 100),
    previousMinor: savedInMonth(shiftMonth(month, -1)),
    history,
  };
}

/**
 * What is left to live on after savings are taken out.
 *
 * The number a household actually operates on once it has paid itself first, which is
 * exactly the arrangement the owner set out to reach.
 */
export function getRunway(month: string): {
  month: string;
  incomeMinor: number;
  savedMinor: number;
  spentMinor: number;
  /** income − saved − spent: what is still unspent and unsaved. */
  leftMinor: number;
  /** Committed costs still expected this month, from declared commitments. */
  committedMinor: number;
} {
  parseMonth(month);
  const { start, end } = monthBounds(month);

  const totals = db
    .select({
      type: transactions.type,
      total: sql<number>`sum(${transactions.totalMinor})`,
    })
    .from(transactions)
    .where(and(gte(transactions.occurredOn, start), lt(transactions.occurredOn, end)))
    .groupBy(transactions.type)
    .all();

  const byType = new Map(totals.map((t) => [t.type, t.total]));
  const incomeMinor = byType.get("income") ?? 0;
  const savedMinor = byType.get("transfer") ?? 0;
  const spentMinor = byType.get("expense") ?? 0;

  return {
    month,
    incomeMinor,
    savedMinor,
    spentMinor,
    leftMinor: incomeMinor - savedMinor - spentMinor,
    committedMinor: getBudget(month).committedMinor,
  };
}
