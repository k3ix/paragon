import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { lineItems, transactions, merchants, categories } from "../db/schema";
import { findCategoryByPath } from "./categories";
import { normalizeMerchant } from "./dedup";
import { monthBounds } from "./month";

export type ReassignFilter = {
  fromCategory?: string;
  merchant?: string;
  month?: string;
  transactionIds?: number[];
  lineIds?: number[];
  uncategorizedOnly?: boolean;
};

export type ReassignResult = {
  moved: number;
  toCategory: string;
  sampleMerchants: string[];
};

/** Every category at or beneath `rootId`. Depth is unlimited, so this walks down. */
function subtreeIds(rootId: number): number[] {
  const rows = db
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories)
    .all();

  const childrenOf = new Map<number, number[]>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    const list = childrenOf.get(row.parentId) ?? [];
    list.push(row.id);
    childrenOf.set(row.parentId, list);
  }

  const collected: number[] = [];
  const queue = [rootId];
  const seen = new Set<number>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    collected.push(id);
    queue.push(...(childrenOf.get(id) ?? []));
  }
  return collected;
}

/**
 * Builds the WHERE clause for a filter, or null when the filter is empty.
 *
 * Empty is rejected rather than treated as "everything": moving every line in the
 * database is never the intent, and there is no undo.
 */
function buildConditions(filter: ReassignFilter) {
  const conditions = [];

  if (filter.fromCategory !== undefined) {
    const rootId = findCategoryByPath(filter.fromCategory);
    if (rootId === null) throw new Error(`Unknown category path: ${filter.fromCategory}`);
    // The whole subtree moves: reorganising "Home" means its children too.
    conditions.push(inArray(lineItems.categoryId, subtreeIds(rootId)));
  }

  if (filter.uncategorizedOnly) {
    conditions.push(isNull(lineItems.categoryId));
  }

  if (filter.lineIds?.length) {
    conditions.push(inArray(lineItems.id, filter.lineIds));
  }

  if (filter.transactionIds?.length) {
    conditions.push(inArray(lineItems.transactionId, filter.transactionIds));
  }

  if (filter.merchant !== undefined) {
    const nameNorm = normalizeMerchant(filter.merchant);
    const merchant = db.select().from(merchants).where(eq(merchants.nameNorm, nameNorm)).get();
    // An unknown merchant matches nothing rather than everything.
    const merchantId = merchant?.id ?? -1;
    conditions.push(
      inArray(
        lineItems.transactionId,
        db
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.merchantId, merchantId)),
      ),
    );
  }

  if (filter.month !== undefined) {
    const { start, end } = monthBounds(filter.month);
    conditions.push(
      inArray(
        lineItems.transactionId,
        db
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(gte(transactions.occurredOn, start), lt(transactions.occurredOn, end))),
      ),
    );
  }

  return conditions.length ? and(...conditions) : null;
}

/** Distinct normalized merchant names among the matched lines, at most five. */
function sampleMerchantsFor(where: ReturnType<typeof buildConditions>): string[] {
  if (!where) return [];
  const rows = db
    .selectDistinct({ nameNorm: merchants.nameNorm })
    .from(lineItems)
    .innerJoin(transactions, eq(lineItems.transactionId, transactions.id))
    .innerJoin(merchants, eq(transactions.merchantId, merchants.id))
    .where(where)
    .limit(5)
    .all();
  return rows.map((r) => r.nameNorm);
}

/** What a reassignment would do, without doing it. */
export function previewReassign(filter: ReassignFilter): {
  count: number;
  sampleMerchants: string[];
  totalMinor: number;
} {
  const where = buildConditions(filter);
  if (!where) throw new Error("A reassignment needs at least one filter.");

  const row = db
    .select({
      count: sql<number>`count(*)`,
      total: sql<number | null>`sum(${lineItems.amountMinor})`,
    })
    .from(lineItems)
    .where(where)
    .get();

  return {
    count: row?.count ?? 0,
    totalMinor: row?.total ?? 0,
    sampleMerchants: sampleMerchantsFor(where),
  };
}

/**
 * Moves matched line items to another category.
 *
 * This is the project's headline operation: it is what lets the taxonomy be
 * reorganised without orphaning history. Only `category_id` changes — amounts are
 * never touched, so the line-sum invariant holds by construction.
 */
export function reassignLineItems(filter: ReassignFilter, toCategoryPath: string): ReassignResult {
  const toCategoryId = findCategoryByPath(toCategoryPath);
  if (toCategoryId === null) throw new Error(`Unknown category path: ${toCategoryPath}`);

  const where = buildConditions(filter);
  if (!where) throw new Error("A reassignment needs at least one filter.");

  const sampleMerchants = sampleMerchantsFor(where);

  const matched = db
    .select({ id: lineItems.id })
    .from(lineItems)
    .where(where)
    .all()
    .map((r) => r.id);

  if (matched.length === 0) {
    return { moved: 0, toCategory: toCategoryPath, sampleMerchants: [] };
  }

  // One statement: four hundred lines move together or not at all.
  db.update(lineItems)
    .set({ categoryId: toCategoryId })
    .where(inArray(lineItems.id, matched))
    .run();

  return { moved: matched.length, toCategory: toCategoryPath, sampleMerchants };
}
