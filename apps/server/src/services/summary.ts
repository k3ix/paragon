import { and, eq, gte, lt, sql } from "drizzle-orm";
import type {
  MonthSummary,
  TrendPoint,
  CategorySlice,
  CategoryTreeNode,
} from "@paragon/shared";
import { db } from "../db";
import { transactions, lineItems, categories } from "../db/schema";
import { monthBounds, shiftMonth } from "./month";

export type { MonthSummary, TrendPoint, CategorySlice, CategoryTreeNode };

/** Sum of transaction totals of one type within a month. Transfers are never counted. */
function totalOfType(start: number, end: number, type: "expense" | "income"): number {
  const row = db
    .select({ total: sql<number | null>`sum(${transactions.totalMinor})` })
    .from(transactions)
    .where(
      and(
        eq(transactions.type, type),
        gte(transactions.occurredOn, start),
        lt(transactions.occurredOn, end),
      ),
    )
    .get();
  return row?.total ?? 0;
}

export function getMonthSummary(month: string): MonthSummary {
  const { start, end } = monthBounds(month);
  const incomeMinor = totalOfType(start, end, "income");
  const spentMinor = totalOfType(start, end, "expense");
  const keptMinor = incomeMinor - spentMinor;

  return {
    month,
    incomeMinor,
    spentMinor,
    keptMinor,
    // A rate against zero income has no meaning; the UI shows a dash rather than 0%.
    savingsRate: incomeMinor === 0 ? null : Math.round((keptMinor / incomeMinor) * 100),
  };
}

export function getMonthlyTrend(endMonth: string, count: number): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const month = shiftMonth(endMonth, -i);
    const s = getMonthSummary(month);
    points.push({
      month,
      incomeMinor: s.incomeMinor,
      spentMinor: s.spentMinor,
      savingsRate: s.savingsRate,
    });
  }
  return points;
}

/**
 * Spending for a month grouped by top-level category.
 *
 * Lines are rolled up to their root ancestor: a nineteen-slice donut communicates
 * nothing, and drilling into subcategories is phase 4. Depth is unlimited, so the
 * walk loops rather than joining a fixed number of levels.
 */
export function getCategoryBreakdown(month: string): CategorySlice[] {
  const { start, end } = monthBounds(month);

  const rows = db
    .select({
      categoryId: lineItems.categoryId,
      amountMinor: lineItems.amountMinor,
    })
    .from(lineItems)
    .innerJoin(transactions, eq(lineItems.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.type, "expense"),
        gte(transactions.occurredOn, start),
        lt(transactions.occurredOn, end),
      ),
    )
    .all();

  if (rows.length === 0) return [];

  const all = db
    .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
    .from(categories)
    .all();
  const byId = new Map(all.map((c) => [c.id, c]));

  /** Walks to the root ancestor. The visited set guards against a parent cycle. */
  function rootOf(id: number): { id: number; name: string } | null {
    const visited = new Set<number>();
    let current = byId.get(id);
    while (current && current.parentId !== null && !visited.has(current.id)) {
      visited.add(current.id);
      const parent = byId.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return current ? { id: current.id, name: current.name } : null;
  }

  const buckets = new Map<number | null, { name: string; totalMinor: number }>();
  for (const row of rows) {
    const root = row.categoryId === null ? null : rootOf(row.categoryId);
    const key = root?.id ?? null;
    const name = root?.name ?? "Uncategorized";
    const bucket = buckets.get(key) ?? { name, totalMinor: 0 };
    bucket.totalMinor += row.amountMinor;
    buckets.set(key, bucket);
  }

  const total = [...buckets.values()].reduce((sum, b) => sum + b.totalMinor, 0);

  return [...buckets.entries()]
    .map(([categoryId, b]) => ({
      categoryId,
      name: b.name,
      path: b.name,
      totalMinor: b.totalMinor,
      share: total === 0 ? 0 : Math.round((b.totalMinor / total) * 100),
    }))
    .sort((a, b) => b.totalMinor - a.totalMinor);
}

/** Spending per category id in a window, without any rollup. */
function directSpendByCategory(start: number, end: number): Map<number | null, number> {
  const rows = db
    .select({
      categoryId: lineItems.categoryId,
      total: sql<number>`sum(${lineItems.amountMinor})`,
    })
    .from(lineItems)
    .innerJoin(transactions, eq(transactions.id, lineItems.transactionId))
    .where(
      and(
        eq(transactions.type, "expense"),
        gte(transactions.occurredOn, start),
        lt(transactions.occurredOn, end),
      ),
    )
    .groupBy(lineItems.categoryId)
    .all();

  return new Map(rows.map((r) => [r.categoryId, r.total]));
}

/**
 * Spending as a tree: every category with its children beneath it, each carrying its
 * own subtotal plus everything filed under its descendants.
 *
 * Replaces the flat rollup on the dashboard. A parent-only view hides the split
 * between, say, groceries and alcohol — which is the split worth seeing.
 */
export function getCategoryTreeBreakdown(month: string): CategoryTreeNode[] {
  const now = monthBounds(month);
  const before = monthBounds(shiftMonth(month, -1));
  return buildTree(now.start, now.end, before.start, before.end);
}

/**
 * The same tree over an arbitrary window, so a pay period can be reported the same
 * way a month is. The comparison window is the one immediately before it, of equal
 * length — for a pay period that is roughly the previous paycheque.
 */
export function getCategoryTreeForRange(start: number, end: number): CategoryTreeNode[] {
  const span = end - start;
  return buildTree(start, end, start - span, start);
}

function buildTree(
  start: number,
  end: number,
  previousStart: number,
  previousEnd: number,
): CategoryTreeNode[] {
  const current = directSpendByCategory(start, end);
  const previous = directSpendByCategory(previousStart, previousEnd);

  const all = db
    .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
    .from(categories)
    .all();

  const childrenOf = new Map<number | null, typeof all>();
  for (const row of all) {
    const siblings = childrenOf.get(row.parentId) ?? [];
    siblings.push(row);
    childrenOf.set(row.parentId, siblings);
  }

  const monthTotal = [...current.values()].reduce((a, b) => a + b, 0);

  /**
   * Builds a node and its subtree, returning null when nothing was spent anywhere in
   * it. `seen` guards against a parent cycle, which would otherwise recurse forever.
   */
  function build(
    row: { id: number; name: string },
    prefix: string,
    seen: Set<number>,
  ): CategoryTreeNode | null {
    if (seen.has(row.id)) return null;
    const path = prefix ? `${prefix}/${row.name}` : row.name;
    const descended = new Set(seen).add(row.id);

    const children = (childrenOf.get(row.id) ?? [])
      .map((child) => build(child, path, descended))
      .filter((n): n is CategoryTreeNode => n !== null)
      .sort((a, b) => b.totalMinor - a.totalMinor);

    const totalMinor =
      (current.get(row.id) ?? 0) + children.reduce((sum, c) => sum + c.totalMinor, 0);
    const previousMinor =
      (previous.get(row.id) ?? 0) + children.reduce((sum, c) => sum + c.previousMinor, 0);

    // A category with nothing spent in this window has no row: showing "0.00" beside
    // a delta against the previous window is noise, not information.
    if (totalMinor === 0) return null;

    return {
      categoryId: row.id,
      name: row.name,
      path,
      totalMinor,
      share: monthTotal === 0 ? 0 : Math.round((totalMinor / monthTotal) * 100),
      previousMinor,
      deltaMinor: totalMinor - previousMinor,
      children,
    };
  }

  const roots = (childrenOf.get(null) ?? [])
    .map((row) => build(row, "", new Set()))
    .filter((n): n is CategoryTreeNode => n !== null);

  // Lines with no category belong to no branch, but hiding them would make the tree
  // disagree with the month total.
  const uncategorized = current.get(null) ?? 0;
  const uncategorizedPrevious = previous.get(null) ?? 0;
  if (uncategorized > 0) {
    roots.push({
      categoryId: null,
      name: "Без категории",
      // Empty, so the purchase filter selects "no category" rather than a branch.
      path: "",
      totalMinor: uncategorized,
      share: monthTotal === 0 ? 0 : Math.round((uncategorized / monthTotal) * 100),
      previousMinor: uncategorizedPrevious,
      deltaMinor: uncategorized - uncategorizedPrevious,
      children: [],
    });
  }

  return roots.sort((a, b) => b.totalMinor - a.totalMinor);
}
