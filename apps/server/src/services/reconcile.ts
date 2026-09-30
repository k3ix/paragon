import { eq, gte, or, and } from "drizzle-orm";
import { db } from "../db";
import { transactions } from "../db/schema";
import { listAccounts } from "./assets";

export type Reconciliation = {
  accountId: number;
  name: string;
  expectedMinor: number;
  statedMinor: number;
  differenceMinor: number;
};

/**
 * Unix seconds for a "YYYY-MM-DD" day, at UTC midnight.
 *
 * Must match `parseDate` in transactions.ts, which stores days the same way. Using
 * local midnight here would shift the boundary by an hour or two and silently drop a
 * movement recorded on the opening day itself.
 */
function dayStart(day: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!match) throw new Error(`Invalid date, expected YYYY-MM-DD: ${day}`);
  const [, y, m, d] = match;
  return Math.floor(Date.UTC(Number(y), Number(m) - 1, Number(d)) / 1000);
}

/**
 * Compares what the application was told against what the bank says.
 *
 * The drift is the point. Savings movements are few, large, and recorded as they
 * happen, so a difference means one of them was missed — which is exactly the failure
 * this whole feature exists to catch. This works here only because everyday cards are
 * excluded: a card would disagree by lunchtime and the warning would be ignored
 * forever after.
 *
 * Accounts with no opening date are skipped rather than reported. There is nothing to
 * count from, so any figure produced would be arbitrary.
 */
export function reconcileAccounts(): Reconciliation[] {
  const gaps: Reconciliation[] = [];

  for (const account of listAccounts()) {
    if (account.openedOn === null) continue;
    const since = dayStart(account.openedOn);

    const rows = db
      .select()
      .from(transactions)
      .where(
        and(
          gte(transactions.occurredOn, since),
          or(eq(transactions.toAccountId, account.id), eq(transactions.fromAccountId, account.id)),
        ),
      )
      .all();

    // A negative total is how a returned deposit is already recorded, so a row
    // pointing into an account with a negative amount correctly reduces it.
    const movement = rows.reduce((sum, row) => {
      if (row.toAccountId === account.id) return sum + row.totalMinor;
      return sum - row.totalMinor;
    }, 0);

    const expectedMinor = account.openingMinor + movement;
    if (expectedMinor === account.balanceMinor) continue;

    gaps.push({
      accountId: account.id,
      name: account.name,
      expectedMinor,
      statedMinor: account.balanceMinor,
      differenceMinor: account.balanceMinor - expectedMinor,
    });
  }

  return gaps;
}
