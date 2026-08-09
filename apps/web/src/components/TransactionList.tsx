import { useState, type ReactNode } from "react";
import { dayLabel, money } from "../lib/format";

type Row = {
  id: number;
  occurredOn: number;
  type: string;
  totalMinor: number;
  merchantRaw: string | null;
  note: string | null;
  lines: { id: number; amountMinor: number; categoryPath: string | null; note: string | null }[];
};

/** "groceries +2" — the first category plus how many others share the receipt. */
function categoryLabel(lines: Row["lines"]): string {
  const first = lines[0]?.categoryPath;
  const leaf = first ? (first.split("/").at(-1) ?? first) : "uncategorized";
  return lines.length > 1 ? `${leaf} +${lines.length - 1}` : leaf;
}

export function TransactionList({
  rows,
  renderEditor,
}: {
  rows: Row[];
  renderEditor: (row: Row, close: () => void) => ReactNode;
}) {
  const [openId, setOpenId] = useState<number | null>(null);

  if (rows.length === 0) {
    return (
      <section className="border-t border-ink-700 pt-6">
        <h2 className="text-xs uppercase tracking-widest text-ink-300">Purchases</h2>
        <p className="mt-4 text-sm text-ink-300">
          Nothing recorded this month. Send a receipt photo to Claude to add one.
        </p>
      </section>
    );
  }

  return (
    <section className="border-t border-ink-700 pt-6">
      <h2 className="text-xs uppercase tracking-widest text-ink-300">Purchases</h2>

      <ul className="mt-4">
        {rows.map((row) => (
          <li key={row.id} className="border-b border-ink-700 last:border-0">
            <button
              type="button"
              onClick={() => setOpenId(openId === row.id ? null : row.id)}
              aria-expanded={openId === row.id}
              className="grid w-full grid-cols-[3.5rem_1fr_auto] items-center gap-3 py-2.5 text-left text-sm hover:bg-ink-800/50 sm:grid-cols-[3.5rem_1fr_8rem_auto]"
            >
              <span className="tnum text-ink-300">{dayLabel(row.occurredOn)}</span>
              <span className="truncate">{row.merchantRaw ?? "—"}</span>
              <span className="hidden sm:block">
                <span className="rounded bg-ink-800 px-2 py-0.5 text-xs text-ink-300">
                  {row.type === "transfer" ? "transfer" : categoryLabel(row.lines)}
                </span>
              </span>
              <span
                className={`tnum whitespace-nowrap text-right ${
                  row.type === "income"
                    ? "text-gain"
                    : row.type === "transfer"
                      ? "text-ink-300"
                      : ""
                }`}
              >
                {row.type === "expense" ? "−" : row.type === "income" ? "+" : ""}
                {money(row.totalMinor)}
              </span>
            </button>

            {openId === row.id && renderEditor(row, () => setOpenId(null))}
          </li>
        ))}
      </ul>
    </section>
  );
}
