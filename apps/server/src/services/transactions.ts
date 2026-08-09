import { eq } from "drizzle-orm";
import type { AddTransactionInput } from "@paragon/shared";
import { db } from "../db";
import { transactions, lineItems, merchants } from "../db/schema";
import { parseAmountToMinor } from "../money";
import { normalizeMerchant, computeDedupHash } from "./dedup";
import { findCategoryByPath } from "./categories";

export type { AddTransactionInput };

export type AddResult =
  | { status: "created"; id: number }
  | { status: "already_exists"; id: number };

/** Converts YYYY-MM-DD to Unix seconds at UTC midnight. */
function parseDate(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) throw new Error(`Invalid date, expected YYYY-MM-DD: ${date}`);
  const [, y, m, d] = match;
  return Math.floor(Date.UTC(Number(y), Number(m) - 1, Number(d)) / 1000);
}

/**
 * Finds or creates the merchant row, bumps its sighting counter, and records the
 * category to default to next time.
 *
 * `learnCategoryId` is the category of a single-category transaction, or null when
 * the receipt was split — a mixed basket teaches nothing about where the shop belongs.
 * The most recent single-category filing wins rather than the most frequent, so a
 * deliberate correction takes effect at once instead of being outvoted by history.
 */
function upsertMerchant(
  nameNorm: string,
  occurredOn: number,
  learnCategoryId: number | null,
): number {
  const existing = db.select().from(merchants).where(eq(merchants.nameNorm, nameNorm)).get();

  if (existing) {
    db.update(merchants)
      .set({
        seenCount: existing.seenCount + 1,
        lastSeenAt: Math.max(existing.lastSeenAt ?? 0, occurredOn),
        // Keep the previous default when this receipt teaches nothing.
        defaultCategoryId: learnCategoryId ?? existing.defaultCategoryId,
      })
      .where(eq(merchants.id, existing.id))
      .run();
    return existing.id;
  }

  return db
    .insert(merchants)
    .values({
      nameNorm,
      seenCount: 1,
      lastSeenAt: occurredOn,
      defaultCategoryId: learnCategoryId,
    })
    .returning({ id: merchants.id })
    .get().id;
}

/**
 * Writes transactions with their receipt lines.
 *
 * Two invariants hold here rather than at the call site, so the MCP tools, the
 * future HTTP API and the frontend cannot diverge:
 *   1. the line amounts must sum to the transaction total;
 *   2. a repeat of the same receipt returns already_exists instead of inserting.
 */
export function addTransactions(items: AddTransactionInput[]): AddResult[] {
  return items.map((item) => addOne(item));
}

function addOne(item: AddTransactionInput): AddResult {
  const occurredOn = parseDate(item.date);
  const totalMinor = parseAmountToMinor(item.total);

  // No breakdown means one line for the whole amount, left uncategorized. A push
  // notification carries an amount but no receipt, so the category comes later.
  const lines = item.lineItems?.length
    ? item.lineItems
    : [{ amount: item.total, category: undefined, note: undefined }];

  // Resolve categories before opening the transaction so a bad path fails cleanly.
  const resolved = lines.map((line) => {
    const amountMinor = parseAmountToMinor(line.amount);
    if (!line.category) {
      return { amountMinor, categoryId: null, note: line.note ?? null };
    }
    const categoryId = findCategoryByPath(line.category);
    if (categoryId === null) {
      throw new Error(`Unknown category path: ${line.category}`);
    }
    return { amountMinor, categoryId, note: line.note ?? null };
  });

  const sum = resolved.reduce((acc, line) => acc + line.amountMinor, 0);
  if (sum !== totalMinor) {
    throw new Error(
      `Line items sum (${sum}) does not match the total (${totalMinor}). ` +
        `Difference: ${totalMinor - sum} minor units.`,
    );
  }

  const merchantRaw = item.merchant ?? null;
  const merchantNorm = merchantRaw ? normalizeMerchant(merchantRaw) : "";
  const dedupHash = computeDedupHash({ occurredOn, totalMinor, merchantNorm });

  const existing = db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.dedupHash, dedupHash))
    .get();

  if (existing) return { status: "already_exists", id: existing.id };

  // Everything below is one unit of work: a failed line write must not leave a
  // transaction row behind.
  return db.transaction((tx) => {
    // Transfers are movements between own accounts and have no merchant.
    // A single line with a category is an unambiguous filing; anything else is not.
    const learnCategoryId =
      resolved.length === 1 && resolved[0]!.categoryId !== null ? resolved[0]!.categoryId : null;

    const merchantId =
      merchantNorm && item.type !== "transfer"
        ? upsertMerchant(merchantNorm, occurredOn, learnCategoryId)
        : null;

    const inserted = tx
      .insert(transactions)
      .values({
        occurredOn,
        type: item.type ?? "expense",
        totalMinor,
        currency: item.currency ?? "PLN",
        // Millionths keeps the rate integral: 4.33 becomes 4330000.
        fxRate: item.fxRate === undefined ? null : Math.round(item.fxRate * 1_000_000),
        merchantRaw,
        merchantId,
        payer: item.payer ?? null,
        scope: item.scope ?? null,
        account: item.account ?? null,
        note: item.note ?? null,
        dedupHash,
      })
      .returning({ id: transactions.id })
      .get();

    for (const line of resolved) {
      tx.insert(lineItems)
        .values({
          transactionId: inserted.id,
          amountMinor: line.amountMinor,
          categoryId: line.categoryId,
          note: line.note,
        })
        .run();
    }

    return { status: "created" as const, id: inserted.id };
  });
}
