import { parseAmountToMinor } from "../money";
import { findCategoryByPath } from "./categories";

export type ResolvedLine = {
  amountMinor: number;
  categoryId: number | null;
  note: string | null;
};

export type LineInput = {
  amount: string | number;
  category?: string;
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
    : [{ amount: fallbackTotal, category: undefined, note: undefined }];

  return source.map((line) => {
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
