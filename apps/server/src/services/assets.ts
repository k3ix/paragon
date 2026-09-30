import { eq, isNull, asc } from "drizzle-orm";
import { db } from "../db";
import { accounts, holdings } from "../db/schema";

export type Account = {
  id: number;
  name: string;
  currency: string;
  balanceMinor: number;
  openingMinor: number;
  openedOn: string | null;
  rateBp: number | null;
  promoUntil: string | null;
};

export type Holding = {
  id: number;
  name: string;
  kind: "equity" | "bond";
  investedMinor: number;
  valueMinor: number | null;
  valuedAt: string | null;
  rateBp: number | null;
  maturesOn: string | null;
};

export type AccountInput = {
  name: string;
  balanceMinor: number;
  openingMinor: number;
  currency?: string;
  openedOn?: string | null;
  rateBp?: number | null;
  promoUntil?: string | null;
  archived?: boolean;
};

export type HoldingInput = {
  name: string;
  kind: "equity" | "bond";
  investedMinor: number;
  rateBp?: number | null;
  maturesOn?: string | null;
  archived?: boolean;
};

function toAccount(row: typeof accounts.$inferSelect): Account {
  return {
    id: row.id,
    name: row.name,
    currency: row.currency,
    balanceMinor: row.balanceMinor,
    openingMinor: row.openingMinor,
    openedOn: row.openedOn,
    rateBp: row.rateBp,
    promoUntil: row.promoUntil,
  };
}

/** Rows come back with `kind` widened to string; this narrows it once, centrally. */
function toHolding(row: typeof holdings.$inferSelect): Holding {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === "bond" ? "bond" : "equity",
    investedMinor: row.investedMinor,
    valueMinor: row.valueMinor,
    valuedAt: row.valuedAt,
    rateBp: row.rateBp,
    maturesOn: row.maturesOn,
  };
}

export function listAccounts(): Account[] {
  return db
    .select()
    .from(accounts)
    .where(isNull(accounts.archivedAt))
    .orderBy(asc(accounts.id))
    .all()
    .map(toAccount);
}

export function createAccount(input: AccountInput): Account {
  const row = db
    .insert(accounts)
    .values({
      name: input.name,
      currency: input.currency ?? "PLN",
      balanceMinor: input.balanceMinor,
      openingMinor: input.openingMinor,
      openedOn: input.openedOn ?? null,
      rateBp: input.rateBp ?? null,
      promoUntil: input.promoUntil ?? null,
    })
    .returning()
    .get();
  return toAccount(row);
}

export function updateAccount(id: number, input: Partial<AccountInput>): Account {
  const existing = db.select().from(accounts).where(eq(accounts.id, id)).get();
  // "not found" is load-bearing: app.ts maps that phrase to a 404 and everything else
  // a service throws to a 422. A message without it would surface as a 500.
  if (!existing) throw new Error(`Account not found: ${id}`);

  const row = db
    .update(accounts)
    .set({
      name: input.name ?? existing.name,
      balanceMinor: input.balanceMinor ?? existing.balanceMinor,
      openingMinor: input.openingMinor ?? existing.openingMinor,
      openedOn: input.openedOn !== undefined ? input.openedOn : existing.openedOn,
      rateBp: input.rateBp !== undefined ? input.rateBp : existing.rateBp,
      promoUntil: input.promoUntil !== undefined ? input.promoUntil : existing.promoUntil,
      archivedAt: input.archived ? Math.floor(Date.now() / 1000) : existing.archivedAt,
    })
    .where(eq(accounts.id, id))
    .returning()
    .get();
  return toAccount(row);
}

export function listHoldings(): Holding[] {
  return db
    .select()
    .from(holdings)
    .where(isNull(holdings.archivedAt))
    .orderBy(asc(holdings.id))
    .all()
    .map(toHolding);
}

export function createHolding(input: HoldingInput): Holding {
  const row = db
    .insert(holdings)
    .values({
      name: input.name,
      kind: input.kind,
      investedMinor: input.investedMinor,
      rateBp: input.rateBp ?? null,
      maturesOn: input.maturesOn ?? null,
    })
    .returning()
    .get();
  return toHolding(row);
}

/**
 * Sets what a holding is worth today.
 *
 * Deliberately not a transaction: the money did not move, only the price. Recording it
 * as income would inflate what the period reports as earned and corrupt every
 * comparison between months.
 */
export function revalueHolding(id: number, valueMinor: number, valuedAt: string): Holding {
  const existing = db.select().from(holdings).where(eq(holdings.id, id)).get();
  // See updateAccount: the phrase drives the HTTP status.
  if (!existing) throw new Error(`Holding not found: ${id}`);

  const row = db
    .update(holdings)
    .set({ valueMinor, valuedAt })
    .where(eq(holdings.id, id))
    .returning()
    .get();
  return toHolding(row);
}

export type HoldingWithGrowth = Holding & {
  growthMinor: number | null;
  growthPercent: number | null;
};

export type AssetsSummary = {
  totalMinor: number;
  accounts: Account[];
  accountsTotalMinor: number;
  holdings: HoldingWithGrowth[];
  holdingsInvestedMinor: number;
  holdingsValueMinor: number;
  staleValuations: { id: number; name: string; valuedAt: string | null }[];
  expiringPromos: { id: number; name: string; promoUntil: string }[];
};

/** "YYYY-MM-DD" a given number of days from today, in local time. */
function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * What is held, and what it has done.
 *
 * A holding with no valuation counts at what was put into it. Treating an absent price
 * as zero would report a holding bought this morning as a total loss, and drag the
 * headline total down with it. Growth stays null in that case rather than claiming a
 * gain of zero, because "not yet known" and "unchanged" are different facts.
 */
export function assetsSummary(): AssetsSummary {
  const accountRows = listAccounts();
  const holdingRows = listHoldings();

  const accountsTotalMinor = accountRows.reduce((sum, a) => sum + a.balanceMinor, 0);

  const withGrowth: HoldingWithGrowth[] = holdingRows.map((h) => {
    if (h.valueMinor === null) {
      return { ...h, growthMinor: null, growthPercent: null };
    }
    const growthMinor = h.valueMinor - h.investedMinor;
    return {
      ...h,
      growthMinor,
      // A holding that cost nothing has no percentage to report; dividing would be
      // infinity, and rounding infinity produces a number that looks meaningful.
      growthPercent:
        h.investedMinor === 0 ? null : Math.round((growthMinor / h.investedMinor) * 100),
    };
  });

  const holdingsInvestedMinor = holdingRows.reduce((sum, h) => sum + h.investedMinor, 0);
  const holdingsValueMinor = holdingRows.reduce(
    (sum, h) => sum + (h.valueMinor ?? h.investedMinor),
    0,
  );

  const monthAgo = dayOffset(-30);
  const monthAhead = dayOffset(30);
  const today = dayOffset(0);

  return {
    totalMinor: accountsTotalMinor + holdingsValueMinor,
    accounts: accountRows,
    accountsTotalMinor,
    holdings: withGrowth,
    holdingsInvestedMinor,
    holdingsValueMinor,
    staleValuations: holdingRows
      .filter((h) => h.valuedAt !== null && h.valuedAt < monthAgo)
      .map((h) => ({ id: h.id, name: h.name, valuedAt: h.valuedAt })),
    expiringPromos: accountRows
      .filter((a) => a.promoUntil !== null && a.promoUntil >= today && a.promoUntil <= monthAhead)
      .map((a) => ({ id: a.id, name: a.name, promoUntil: a.promoUntil as string })),
  };
}
