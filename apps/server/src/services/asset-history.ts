import { eq, or, asc } from "drizzle-orm";
import { db } from "../db";
import { transactions, accounts } from "../db/schema";
import { listLots, listValuations, type Lot, type Valuation } from "./assets";

export type Movement = {
  id: number;
  occurredOn: number;
  // Signed from this asset's point of view: positive arrived, negative left.
  totalMinor: number;
  note: string | null;
  merchant: string | null;
  // Balance after this movement, counted forward from the account's opening figure.
  runningMinor: number;
};

/**
 * What built a balance.
 *
 * The running total starts at the account's opening figure and moves with each row, so
 * the last line should equal what the account says it holds. When it does not, the
 * reconciliation warning on the same screen already explains why.
 *
 * Direction comes from which column names the account, with one wrinkle: a negative
 * total pointing *into* an account is how a withdrawal and a returned deposit are both
 * recorded, and adding a negative handles it without a special case.
 */
export function accountHistory(accountId: number): { movements: Movement[] } {
  const rows = db
    .select({
      id: transactions.id,
      occurredOn: transactions.occurredOn,
      totalMinor: transactions.totalMinor,
      note: transactions.note,
      merchantRaw: transactions.merchantRaw,
      toAccountId: transactions.toAccountId,
    })
    .from(transactions)
    .where(
      or(eq(transactions.toAccountId, accountId), eq(transactions.fromAccountId, accountId)),
    )
    .orderBy(asc(transactions.occurredOn), asc(transactions.id))
    .all();

  // The running total starts where the account did, not at zero, so the last line can
  // be compared against what the account says it holds today.
  const account = db
    .select({ openingMinor: accounts.openingMinor })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .get();

  let running = account?.openingMinor ?? 0;

  const movements = rows.map((row) => {
    const delta = row.toAccountId === accountId ? row.totalMinor : -row.totalMinor;
    running += delta;
    return {
      id: row.id,
      occurredOn: row.occurredOn,
      totalMinor: delta,
      note: row.note,
      merchant: row.merchantRaw,
      runningMinor: running,
    };
  });

  return { movements };
}

/**
 * What built a holding: the money that went in, what it bought, and what it has been
 * worth since.
 *
 * The running total starts at zero rather than at an opening figure: holdings have no
 * equivalent of `opening_minor`, and their `invested` is maintained by the same
 * transfers this list walks.
 */
export function holdingHistory(holdingId: number): {
  movements: Movement[];
  lots: Lot[];
  valuations: Valuation[];
} {
  const rows = db
    .select({
      id: transactions.id,
      occurredOn: transactions.occurredOn,
      totalMinor: transactions.totalMinor,
      note: transactions.note,
      merchantRaw: transactions.merchantRaw,
      toHoldingId: transactions.toHoldingId,
    })
    .from(transactions)
    .where(
      or(eq(transactions.toHoldingId, holdingId), eq(transactions.fromHoldingId, holdingId)),
    )
    .orderBy(asc(transactions.occurredOn), asc(transactions.id))
    .all();

  let running = 0;

  const movements = rows.map((row) => {
    const delta = row.toHoldingId === holdingId ? row.totalMinor : -row.totalMinor;
    running += delta;
    return {
      id: row.id,
      occurredOn: row.occurredOn,
      totalMinor: delta,
      note: row.note,
      merchant: row.merchantRaw,
      runningMinor: running,
    };
  });

  return { movements, lots: listLots(holdingId), valuations: listValuations(holdingId) };
}
