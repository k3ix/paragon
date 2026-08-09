import { formatMinor } from "../money";
import { listTransactions } from "./queries";

/** Wraps a field in quotes when it contains a comma, quote or newline. */
function csvField(value: string | null): string {
  const text = value ?? "";
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Unix seconds to "YYYY-MM-DD". */
function isoDate(occurredOn: number): string {
  return new Date(occurredOn * 1000).toISOString().slice(0, 10);
}

const HEADER = "date,merchant,category,amount,currency,type,transaction_id,note";

/**
 * One row per line item, not per transaction.
 *
 * A receipt split three ways is three rows sharing a transaction id. Collapsing to one
 * row per transaction would discard the breakdown the data model exists to record.
 * Amounts are decimals here because this file is meant to be opened by a person.
 */
export function exportCsv(filter?: { month?: string }): string {
  const { rows } = listTransactions({ month: filter?.month, limit: 100_000 });

  const lines = rows.flatMap((tx) =>
    tx.lines.map((line) =>
      [
        isoDate(tx.occurredOn),
        csvField(tx.merchantRaw),
        csvField(line.categoryPath),
        formatMinor(line.amountMinor),
        tx.currency,
        tx.type,
        String(tx.id),
        csvField(line.note ?? tx.note),
      ].join(","),
    ),
  );

  return [HEADER, ...lines].join("\n") + "\n";
}

/**
 * The full history as JSON, in minor units.
 *
 * Unlike the CSV, this is meant to be read back by a machine, so amounts stay integral
 * and nothing is rounded on the way out.
 */
export function exportJson(filter?: { month?: string }): string {
  const { rows, total } = listTransactions({ month: filter?.month, limit: 100_000 });

  return JSON.stringify(
    {
      exportedAt: Math.floor(Date.now() / 1000),
      count: total,
      transactions: rows,
    },
    null,
    2,
  );
}
