import { and, desc, eq, gte, lt, sql, inArray } from "drizzle-orm";
import { db } from "../db";
import { transactions, lineItems, categories } from "../db/schema";
import { monthBounds } from "./month";
import { resolvePeriod } from "./periods";

export type TransactionLine = {
  id: number;
  amountMinor: number;
  categoryPath: string | null;
  note: string | null;
};

export type TransactionRow = {
  id: number;
  occurredOn: number;
  type: string;
  totalMinor: number;
  currency: string;
  merchantRaw: string | null;
  note: string | null;
  lines: TransactionLine[];
};

/** Builds every category's full path in one pass, so rows do not query per line. */
function categoryPaths(): Map<number, string> {
  const all = db
    .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
    .from(categories)
    .all();
  const byId = new Map(all.map((c) => [c.id, c]));
  const paths = new Map<number, string>();

  for (const category of all) {
    const segments: string[] = [];
    const visited = new Set<number>();
    let current: (typeof all)[number] | undefined = category;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      segments.unshift(current.name);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    paths.set(category.id, segments.join("/"));
  }

  return paths;
}

export function listTransactions(filter: {
  month?: string;
  /** A period id — "2026-08" or "pay-2026-08-10". Takes precedence over `month`. */
  period?: string;
  /** "Now", for resolving an open pay period. Injected by tests. */
  now?: number;
  type?: string;
  limit?: number;
  offset?: number;
}): { rows: TransactionRow[]; total: number } {
  const conditions = [];
  if (filter.period) {
    const { start, end } = resolvePeriod(filter.period, filter.now);
    conditions.push(gte(transactions.occurredOn, start));
    conditions.push(lt(transactions.occurredOn, end));
  } else if (filter.month) {
    const { start, end } = monthBounds(filter.month);
    conditions.push(gte(transactions.occurredOn, start));
    conditions.push(lt(transactions.occurredOn, end));
  }
  if (filter.type) conditions.push(eq(transactions.type, filter.type));
  const where = conditions.length ? and(...conditions) : undefined;

  const countRow = db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(where)
    .get();
  const total = countRow?.count ?? 0;

  const txRows = db
    .select()
    .from(transactions)
    .where(where)
    .orderBy(desc(transactions.occurredOn), desc(transactions.id))
    .limit(filter.limit ?? 100)
    .offset(filter.offset ?? 0)
    .all();

  if (txRows.length === 0) return { rows: [], total };

  const paths = categoryPaths();
  const lineRows = db
    .select()
    .from(lineItems)
    .where(
      inArray(
        lineItems.transactionId,
        txRows.map((t) => t.id),
      ),
    )
    .all();

  const linesByTx = new Map<number, TransactionLine[]>();
  for (const line of lineRows) {
    const list = linesByTx.get(line.transactionId) ?? [];
    list.push({
      id: line.id,
      amountMinor: line.amountMinor,
      categoryPath: line.categoryId === null ? null : (paths.get(line.categoryId) ?? null),
      note: line.note,
    });
    linesByTx.set(line.transactionId, list);
  }

  return {
    rows: txRows.map((t) => ({
      id: t.id,
      occurredOn: t.occurredOn,
      type: t.type,
      totalMinor: t.totalMinor,
      currency: t.currency,
      merchantRaw: t.merchantRaw,
      note: t.note,
      lines: linesByTx.get(t.id) ?? [],
    })),
    total,
  };
}
