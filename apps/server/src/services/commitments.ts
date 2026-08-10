import { eq } from "drizzle-orm";
import { db } from "../db";
import { commitments } from "../db/schema";
import { parseMonth } from "./month";

export type Commitment = {
  id: number;
  kind: "income" | "expense";
  name: string;
  amountMinor: number;
  categoryId: number | null;
  activeFrom: string;
  activeTo: string | null;
};

export type CommitmentInput = {
  kind: "income" | "expense";
  name: string;
  amountMinor: number;
  categoryId?: number | null;
  activeFrom: string;
  activeTo?: string | null;
};

/** Rows come back with `kind` widened to string; this narrows it once, centrally. */
function toCommitment(row: typeof commitments.$inferSelect): Commitment {
  return {
    id: row.id,
    kind: row.kind === "income" ? "income" : "expense",
    name: row.name,
    amountMinor: row.amountMinor,
    categoryId: row.categoryId,
    activeFrom: row.activeFrom,
    activeTo: row.activeTo,
  };
}

/** Both months are validated, and an inverted range is rejected outright. */
function checkRange(activeFrom: string, activeTo?: string | null): void {
  parseMonth(activeFrom);
  if (activeTo != null) {
    parseMonth(activeTo);
    if (activeTo < activeFrom) {
      throw new Error(`A commitment cannot end before it starts: ${activeFrom} to ${activeTo}`);
    }
  }
}

export function listCommitments(): Commitment[] {
  return db.select().from(commitments).all().map(toCommitment);
}

export function createCommitment(input: CommitmentInput): Commitment {
  checkRange(input.activeFrom, input.activeTo);
  if (input.amountMinor <= 0) throw new Error("A commitment amount must be positive.");

  const row = db
    .insert(commitments)
    .values({
      kind: input.kind,
      name: input.name.trim(),
      amountMinor: input.amountMinor,
      categoryId: input.categoryId ?? null,
      activeFrom: input.activeFrom,
      activeTo: input.activeTo ?? null,
    })
    .returning()
    .get();
  return toCommitment(row);
}

export function updateCommitment(id: number, patch: Partial<CommitmentInput>): Commitment {
  const current = db.select().from(commitments).where(eq(commitments.id, id)).get();
  if (!current) throw new Error(`Commitment not found: ${id}`);

  const activeFrom = patch.activeFrom ?? current.activeFrom;
  const activeTo = patch.activeTo === undefined ? current.activeTo : patch.activeTo;
  checkRange(activeFrom, activeTo);
  if (patch.amountMinor !== undefined && patch.amountMinor <= 0) {
    throw new Error("A commitment amount must be positive.");
  }

  const row = db
    .update(commitments)
    .set({
      ...(patch.kind !== undefined && { kind: patch.kind }),
      ...(patch.name !== undefined && { name: patch.name.trim() }),
      ...(patch.amountMinor !== undefined && { amountMinor: patch.amountMinor }),
      ...(patch.categoryId !== undefined && { categoryId: patch.categoryId }),
      activeFrom,
      activeTo,
    })
    .where(eq(commitments.id, id))
    .returning()
    .get();
  return toCommitment(row);
}

/**
 * Closes a commitment at the end of `lastMonth` instead of deleting it, so past
 * months keep the amount that actually applied to them.
 */
export function endCommitment(id: number, lastMonth: string): Commitment {
  return updateCommitment(id, { activeTo: lastMonth });
}

/**
 * The commitments in force during a month.
 *
 * "YYYY-MM" compares correctly as a string — the fixed width and zero padding make
 * lexical order match chronological order — so no date parsing is needed here.
 */
export function commitmentsForMonth(month: string): Commitment[] {
  parseMonth(month);
  return listCommitments().filter(
    (c) => c.activeFrom <= month && (c.activeTo === null || month <= c.activeTo),
  );
}
