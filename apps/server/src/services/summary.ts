import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { MonthSummary, TrendPoint, CategorySlice } from "@paragon/shared";
import { db } from "../db";
import { transactions, lineItems, categories } from "../db/schema";

export type { MonthSummary, TrendPoint, CategorySlice };

/**
 * Parses "YYYY-MM" into its year and month number.
 *
 * The range check is not decoration: Date.UTC rolls month 13 over into January of
 * the next year, so "2026-13" would silently return a different month's figures
 * rather than failing. The value arrives from a query string.
 */
function parseMonth(month: string): { year: number; m: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month.trim());
  if (!match) throw new Error(`Invalid month, expected YYYY-MM: ${month}`);
  const year = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12) throw new Error(`Invalid month number, expected 01-12: ${month}`);
  return { year, m };
}

/** Unix-second bounds of a "YYYY-MM" month, half-open: [start, end). */
function monthBounds(month: string): { start: number; end: number } {
  const { year, m } = parseMonth(month);
  const start = Math.floor(Date.UTC(year, m - 1, 1) / 1000);
  const end = Math.floor(Date.UTC(m === 12 ? year + 1 : year, m === 12 ? 0 : m, 1) / 1000);
  return { start, end };
}

/** Shifts "YYYY-MM" by a signed number of months. */
function shiftMonth(month: string, delta: number): string {
  const { year, m } = parseMonth(month);
  const total = year * 12 + (m - 1) + delta;
  const shiftedYear = Math.floor(total / 12);
  const shiftedMonth = (total % 12) + 1;
  return `${shiftedYear}-${String(shiftedMonth).padStart(2, "0")}`;
}

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
