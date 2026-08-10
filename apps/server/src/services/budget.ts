import { and, gte, lt, eq, sql, isNull, or, notInArray } from "drizzle-orm";
import { db } from "../db";
import { transactions, lineItems, categories } from "../db/schema";
import { commitmentsForMonth } from "./commitments";
import { monthBounds, shiftMonth, parseMonth } from "./month";

/** Completed months required before an average of flexible spending means anything. */
const MONTHS_REQUIRED = 3;

/** How far back to look for completed months with spending. */
const LOOKBACK_MONTHS = 12;

export type Budget = {
  month: string;
  /** The declared recurring salary, not what actually landed. Null when undeclared. */
  baseIncomeMinor: number | null;
  /** Declared recurring expenses in force this month. */
  committedMinor: number;
  /** Average of completed months' flexible spending. Null until enough history. */
  flexibleAverageMinor: number | null;
  /** base − committed − flexible average. Null when either input is missing. */
  setAsideMinor: number | null;
  /** Why setAsideMinor is null, for the screen to explain itself. */
  reason: "no-base-income" | "not-enough-history" | null;
  /** Completed months still needed before an average exists. */
  monthsNeeded: number;
  /** Completed months that had any spending at all. */
  monthsObserved: number;
};

/**
 * Every category marked occasional, plus everything beneath it.
 *
 * Marking a parent has to carry to its children, or "Путешествия" would exclude
 * nothing once the trips are filed under subcategories.
 */
export function occasionalCategoryIds(): number[] {
  const all = db
    .select({
      id: categories.id,
      parentId: categories.parentId,
      isOccasional: categories.isOccasional,
    })
    .from(categories)
    .all();

  const childrenOf = new Map<number, number[]>();
  for (const c of all) {
    if (c.parentId === null) continue;
    childrenOf.set(c.parentId, [...(childrenOf.get(c.parentId) ?? []), c.id]);
  }

  const excluded = new Set<number>();
  const queue = all.filter((c) => c.isOccasional).map((c) => c.id);
  while (queue.length > 0) {
    const id = queue.pop()!;
    // The guard also stops a cycle in parent_id from looping forever.
    if (excluded.has(id)) continue;
    excluded.add(id);
    queue.push(...(childrenOf.get(id) ?? []));
  }

  return [...excluded];
}

/** Categories covered by a declared commitment in the given month. */
export function committedCategoryIds(month: string): number[] {
  return commitmentsForMonth(month)
    .filter((c) => c.kind === "expense")
    .map((c) => c.categoryId)
    .filter((id): id is number => id !== null);
}

/** Total expense line amounts in a month, optionally excluding some categories. */
function flexibleSpendInMonth(month: string, excludedCategoryIds: number[]): number {
  const { start, end } = monthBounds(month);
  const row = db
    .select({ total: sql<number | null>`sum(${lineItems.amountMinor})` })
    .from(lineItems)
    .innerJoin(transactions, eq(transactions.id, lineItems.transactionId))
    .where(
      and(
        eq(transactions.type, "expense"),
        gte(transactions.occurredOn, start),
        lt(transactions.occurredOn, end),
        // An uncategorized line has no category to exclude, so it always counts.
        excludedCategoryIds.length > 0
          ? or(
              isNull(lineItems.categoryId),
              notInArray(lineItems.categoryId, excludedCategoryIds),
            )
          : undefined,
      ),
    )
    .get();
  return row?.total ?? 0;
}

/**
 * The payday figure.
 *
 * Anchored to declared base income rather than actual salary rows: overtime and
 * on-call vary month to month, and a figure that rises with them teaches spending
 * habits a weak month cannot pay for. Surplus above base is saved whole and never
 * enters this calculation.
 */
export function getBudget(month: string): Budget {
  parseMonth(month);

  const active = commitmentsForMonth(month);
  const baseIncomeMinor =
    active.filter((c) => c.kind === "income").reduce((sum, c) => sum + c.amountMinor, 0) || null;

  const expenseCommitments = active.filter((c) => c.kind === "expense");
  const committedMinor = expenseCommitments.reduce((sum, c) => sum + c.amountMinor, 0);

  // A category already covered by a commitment would otherwise be counted twice:
  // once as committed, once inside the flexible average.
  const committedCategories = expenseCommitments
    .map((c) => c.categoryId)
    .filter((id): id is number => id !== null);

  // Occasional categories — a holiday, a new laptop — are not part of what an
  // ordinary month costs. Averaging them in would raise the living-cost figure for
  // three months after every trip, and shrink the payday number to match. Money for
  // these is set aside separately.
  const occasionalCategories = occasionalCategoryIds();

  const excluded = [...new Set([...committedCategories, ...occasionalCategories])];

  // Completed months only. The current month is partial, and averaging it against
  // whole months drags the figure below what a month actually costs.
  const observed: number[] = [];
  for (let i = 1; i <= LOOKBACK_MONTHS; i++) {
    const spend = flexibleSpendInMonth(shiftMonth(month, -i), excluded);
    if (spend > 0) observed.push(spend);
  }

  const monthsObserved = observed.length;
  const monthsNeeded = Math.max(MONTHS_REQUIRED - monthsObserved, 0);

  // `observed` runs newest first, so this takes the three most recent months.
  const recent = observed.slice(0, MONTHS_REQUIRED);
  const flexibleAverageMinor =
    recent.length >= MONTHS_REQUIRED
      ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length)
      : null;

  const reason =
    baseIncomeMinor === null
      ? ("no-base-income" as const)
      : flexibleAverageMinor === null
        ? ("not-enough-history" as const)
        : null;

  return {
    month,
    baseIncomeMinor,
    committedMinor,
    flexibleAverageMinor,
    setAsideMinor:
      baseIncomeMinor !== null && flexibleAverageMinor !== null
        ? baseIncomeMinor - committedMinor - flexibleAverageMinor
        : null,
    reason,
    monthsNeeded,
    monthsObserved,
  };
}
