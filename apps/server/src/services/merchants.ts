import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { merchants, categories, transactions } from "../db/schema";
import { normalizeMerchant } from "./dedup";
import { findCategoryByPath } from "./categories";

export type MerchantMemory = {
  nameNorm: string;
  categoryPath: string | null;
  seenCount: number;
  lastSeenAt: number | null;
  averageMinor: number | null;
};

/**
 * Walks a category up to its root and renders the full slash-separated path.
 *
 * Depth is unlimited, so this loops rather than joining a fixed number of levels.
 * The visited set guards against a parent cycle, which the schema permits.
 */
function buildCategoryPath(categoryId: number): string | null {
  const segments: string[] = [];
  const visited = new Set<number>();
  let current: number | null = categoryId;

  while (current !== null) {
    if (visited.has(current)) break;
    visited.add(current);

    const row: { name: string; parentId: number | null } | undefined = db
      .select({ name: categories.name, parentId: categories.parentId })
      .from(categories)
      .where(eq(categories.id, current))
      .get();

    if (!row) break;
    segments.unshift(row.name);
    current = row.parentId;
  }

  return segments.length ? segments.join("/") : null;
}

/** Mean transaction total for a merchant, in minor units. Null when it has none. */
function averageTotal(merchantId: number): number | null {
  const row = db
    .select({ avg: sql<number | null>`avg(${transactions.totalMinor})` })
    .from(transactions)
    .where(eq(transactions.merchantId, merchantId))
    .get();

  return row?.avg === null || row?.avg === undefined ? null : Math.round(row.avg);
}

function toMemory(row: typeof merchants.$inferSelect): MerchantMemory {
  return {
    nameNorm: row.nameNorm,
    categoryPath: row.defaultCategoryId === null ? null : buildCategoryPath(row.defaultCategoryId),
    seenCount: row.seenCount,
    lastSeenAt: row.lastSeenAt,
    averageMinor: averageTotal(row.id),
  };
}

/**
 * Looks up what was decided about a shop last time.
 *
 * The lookup normalizes first, so the receipt spelling ("Żabka") and the statement
 * spelling ("ZABKA") reach the same row.
 */
export function getMerchant(rawName: string): MerchantMemory | null {
  const nameNorm = normalizeMerchant(rawName);
  if (!nameNorm) return null;

  const row = db.select().from(merchants).where(eq(merchants.nameNorm, nameNorm)).get();
  return row ? toMemory(row) : null;
}

/** Every known merchant, most frequently seen first. */
export function listMerchants(): MerchantMemory[] {
  return db.select().from(merchants).orderBy(desc(merchants.seenCount)).all().map(toMemory);
}

/**
 * Pins a merchant to a category, overriding whatever was learned.
 *
 * Only the default for future transactions changes. Rewriting past line items is
 * reassign_line_items in phase 5 and is deliberately not bundled here: correcting a
 * default and rewriting history are different intentions.
 */
export function setMerchantCategory(rawName: string, categoryPath: string): MerchantMemory {
  const nameNorm = normalizeMerchant(rawName);
  if (!nameNorm) throw new Error(`Merchant name is empty: ${rawName}`);

  const categoryId = findCategoryByPath(categoryPath);
  if (categoryId === null) throw new Error(`Unknown category path: ${categoryPath}`);

  const existing = db.select().from(merchants).where(eq(merchants.nameNorm, nameNorm)).get();

  if (existing) {
    db.update(merchants)
      .set({ defaultCategoryId: categoryId })
      .where(eq(merchants.id, existing.id))
      .run();
    return toMemory({ ...existing, defaultCategoryId: categoryId });
  }

  const inserted = db
    .insert(merchants)
    .values({ nameNorm, defaultCategoryId: categoryId, seenCount: 0, lastSeenAt: null })
    .returning()
    .get();

  return toMemory(inserted);
}
