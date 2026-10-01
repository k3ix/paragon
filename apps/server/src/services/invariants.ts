import { eq } from "drizzle-orm";
import { parseAmountToMinor } from "../money";
import { db } from "../db";
import { accounts, holdings } from "../db/schema";
import { findCategoryByPath } from "./categories";

export type ResolvedLine = {
  amountMinor: number;
  categoryId: number | null;
  name: string | null;
  note: string | null;
};

export type LineInput = {
  amount: string | number;
  category?: string;
  name?: string;
  note?: string;
};

/**
 * Turns submitted line items into resolved rows.
 *
 * With no breakdown, one uncategorized line covers the whole amount: a push
 * notification carries a total but no receipt, and the category comes later.
 */
export function resolveLines(
  lines: LineInput[] | undefined,
  fallbackTotal: string | number,
): ResolvedLine[] {
  const source: LineInput[] = lines?.length
    ? lines
    : [{ amount: fallbackTotal, category: undefined, name: undefined, note: undefined }];

  return source.map((line) => {
    const amountMinor = parseAmountToMinor(line.amount);
    if (!line.category) {
      return { amountMinor, categoryId: null, name: line.name ?? null, note: line.note ?? null };
    }
    const categoryId = findCategoryByPath(line.category);
    if (categoryId === null) {
      throw new Error(`Unknown category path: ${line.category}`);
    }
    return { amountMinor, categoryId, name: line.name ?? null, note: line.note ?? null };
  });
}

/**
 * The core invariant: a receipt's lines must account for exactly its total.
 *
 * Enforced on creation and on every edit. Without it an edited receipt can leave
 * the two disagreeing, and every category total that reads those lines is then wrong
 * with nothing to signal it.
 */
export function assertLinesMatchTotal(lines: ResolvedLine[], totalMinor: number): void {
  const sum = lines.reduce((acc, line) => acc + line.amountMinor, 0);
  if (sum !== totalMinor) {
    throw new Error(
      `Line items sum (${sum}) does not match the total (${totalMinor}). ` +
        `Difference: ${totalMinor - sum} minor units.`,
    );
  }
}

export type AssetEndpoints = {
  fromAccountId?: number | null;
  toAccountId?: number | null;
  fromHoldingId?: number | null;
  toHoldingId?: number | null;
};

/**
 * Checks that a transaction names at most one source and one destination, and that
 * each exists.
 *
 * Money leaves one place and arrives in another. Naming an account and a holding on
 * the same side describes nothing real, and reconciliation would have to guess which
 * one to believe. A transfer to the account it came from is likewise incoherent: it
 * nets to zero, so it reconciles clean while looking on screen like money that moved.
 */
export function checkAssetEndpoints(input: AssetEndpoints): void {
  if (input.fromAccountId != null && input.fromHoldingId != null) {
    throw new Error("A transaction cannot name both an account and a holding as its source");
  }
  if (input.toAccountId != null && input.toHoldingId != null) {
    throw new Error("A transaction cannot name both an account and a holding as its destination");
  }
  if (
    input.fromAccountId != null &&
    input.toAccountId != null &&
    input.fromAccountId === input.toAccountId
  ) {
    throw new Error("A transfer cannot move money to the account it came from");
  }
  if (
    input.fromHoldingId != null &&
    input.toHoldingId != null &&
    input.fromHoldingId === input.toHoldingId
  ) {
    throw new Error("A transfer cannot move money to the holding it came from");
  }

  for (const id of [input.fromAccountId, input.toAccountId]) {
    if (id == null) continue;
    if (!db.select().from(accounts).where(eq(accounts.id, id)).get()) {
      throw new Error(`Account not found: ${id}`);
    }
  }
  for (const id of [input.fromHoldingId, input.toHoldingId]) {
    if (id == null) continue;
    if (!db.select().from(holdings).where(eq(holdings.id, id)).get()) {
      throw new Error(`Holding not found: ${id}`);
    }
  }
}
