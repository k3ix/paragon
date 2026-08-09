import { dayLabel, money } from "../lib/format";

type Row = {
  id: number;
  occurredOn: number;
  type: string;
  totalMinor: number;
  merchantRaw: string | null;
  lines: { id: number; categoryPath: string | null }[];
};

/** "groceries +2" — the first category plus how many others share the receipt. */
function categoryLabel(lines: Row["lines"]): string {
  const first = lines[0]?.categoryPath;
  const leaf = first ? (first.split("/").at(-1) ?? first) : "uncategorized";
  return lines.length > 1 ? `${leaf} +${lines.length - 1}` : leaf;
}

export function TransactionList({ rows }: { rows: Row[] }) {
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

      <table className="mt-4 w-full text-sm">
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-ink-700 last:border-0">
              <td className="tnum w-16 py-2.5 text-ink-300">{dayLabel(row.occurredOn)}</td>
              <td className="py-2.5">{row.merchantRaw ?? "—"}</td>
              <td className="py-2.5">
                <span className="rounded bg-ink-800 px-2 py-0.5 text-xs text-ink-300">
                  {row.type === "transfer" ? "transfer" : categoryLabel(row.lines)}
                </span>
              </td>
              <td
                className={`tnum py-2.5 text-right ${
                  row.type === "income" ? "text-gain" : row.type === "transfer" ? "text-ink-300" : ""
                }`}
              >
                {row.type === "expense" ? "−" : row.type === "income" ? "+" : ""}
                {money(row.totalMinor)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
