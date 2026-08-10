import { eq } from "drizzle-orm";
import type { AddTransactionInput } from "@paragon/shared";
import { db } from "../db";
import { transactions, lineItems, merchants } from "../db/schema";
import { parseAmountToMinor } from "../money";
import { normalizeMerchant, computeDedupHash } from "./dedup";
import { resolveLines, assertLinesMatchTotal, type LineInput } from "./invariants";
import { listTransactions, type TransactionRow } from "./queries";

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

  // Resolve categories before opening the transaction so a bad path fails cleanly.
  const resolved = resolveLines(item.lineItems, item.total);
  assertLinesMatchTotal(resolved, totalMinor);

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
          name: line.name,
          note: line.note,
        })
        .run();
    }

    return { status: "created" as const, id: inserted.id };
  });
}

/**
 * Applies a partial edit to a transaction.
 *
 * The dedup hash is recomputed whenever the date, total or merchant changes, so an
 * edit cannot quietly produce a row identical to an existing one — the same guard
 * that protects the write path protects the edit path.
 */
export function updateTransaction(
  id: number,
  patch: {
    date?: string;
    total?: string | number;
    type?: "expense" | "income" | "transfer";
    merchant?: string | null;
    note?: string | null;
    lineItems?: LineInput[];
  },
): TransactionRow {
  const existing = db.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!existing) throw new Error(`Transaction not found: ${id}`);

  const existingLines = db.select().from(lineItems).where(eq(lineItems.transactionId, id)).all();

  const occurredOn = patch.date === undefined ? existing.occurredOn : parseDate(patch.date);
  const totalMinor =
    patch.total === undefined ? existing.totalMinor : parseAmountToMinor(patch.total);
  const merchantRaw = patch.merchant === undefined ? existing.merchantRaw : patch.merchant;
  const type = patch.type ?? (existing.type as "expense" | "income" | "transfer");

  // Changing the total with several lines present has no single right answer: the
  // server cannot know which line absorbs the difference. The caller must send lines.
  if (
    patch.lineItems === undefined &&
    patch.total !== undefined &&
    existingLines.length > 1 &&
    totalMinor !== existing.totalMinor
  ) {
    throw new Error(
      "Changing the total requires line items when the receipt has more than one line.",
    );
  }

  const resolved =
    patch.lineItems !== undefined
      ? resolveLines(patch.lineItems, totalMinor)
      : existingLines.length === 1
        ? [
            {
              amountMinor: totalMinor,
              categoryId: existingLines[0]!.categoryId,
              name: existingLines[0]!.name,
              note: existingLines[0]!.note,
            },
          ]
        : existingLines.map((l) => ({
            amountMinor: l.amountMinor,
            categoryId: l.categoryId,
            name: l.name,
            note: l.note,
          }));

  assertLinesMatchTotal(resolved, totalMinor);

  const merchantNorm = merchantRaw ? normalizeMerchant(merchantRaw) : "";
  const dedupHash = computeDedupHash({ occurredOn, totalMinor, merchantNorm });

  const clash = db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.dedupHash, dedupHash))
    .get();
  if (clash && clash.id !== id) {
    throw new Error(
      `A transaction with the same date, amount and merchant already exists (#${clash.id}).`,
    );
  }

  db.transaction((tx) => {
    const merchantId =
      merchantNorm && type !== "transfer"
        ? upsertMerchant(
            merchantNorm,
            occurredOn,
            resolved.length === 1 && resolved[0]!.categoryId !== null
              ? resolved[0]!.categoryId
              : null,
          )
        : null;

    tx.update(transactions)
      .set({
        occurredOn,
        type,
        totalMinor,
        merchantRaw,
        merchantId,
        note: patch.note === undefined ? existing.note : patch.note,
        dedupHash,
      })
      .where(eq(transactions.id, id))
      .run();

    tx.delete(lineItems).where(eq(lineItems.transactionId, id)).run();
    for (const line of resolved) {
      tx.insert(lineItems)
        .values({
          transactionId: id,
          amountMinor: line.amountMinor,
          categoryId: line.categoryId,
          name: line.name,
          note: line.note,
        })
        .run();
    }
  });

  const row = listTransactions({}).rows.find((r) => r.id === id);
  if (!row) throw new Error(`Transaction not found after update: ${id}`);
  return row;
}

export function deleteTransaction(id: number): { deleted: true } {
  const existing = db.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!existing) throw new Error(`Transaction not found: ${id}`);

  // line_items has ON DELETE CASCADE, but the delete is explicit so the intent is
  // visible at the call site rather than resting on a schema detail.
  db.transaction((tx) => {
    tx.delete(lineItems).where(eq(lineItems.transactionId, id)).run();
    tx.delete(transactions).where(eq(transactions.id, id)).run();
  });

  return { deleted: true };
}
