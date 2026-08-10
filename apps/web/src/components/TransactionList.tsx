import { useState, type ReactNode } from "react";
import { money, dayHeading } from "../lib/format";

type Line = { id: number; amountMinor: number; categoryPath: string | null; note: string | null };

/**
 * Mirrors `TransactionRow` from `apps/server/src/services/queries.ts`. The type is not
 * in `@paragon/shared` — it reaches the browser through Eden's inferred response type,
 * which cannot be named here without importing the whole app type.
 */
type Row = {
  id: number;
  occurredOn: number;
  totalMinor: number;
  merchantRaw: string | null;
  note: string | null;
  lines: Line[];
};

/**
 * Purchases grouped by day with a per-day subtotal.
 *
 * Every line of a split receipt is shown. The previous version collapsed them into
 * "Хозтовары +1", hiding exactly the breakdown that was entered by hand.
 */
export function TransactionList({
  rows,
  filter,
  onClearFilter,
  renderEditor,
}: {
  rows: Row[];
  filter: { path: string; name: string } | null;
  onClearFilter: () => void;
  renderEditor: (row: Row, close: () => void) => ReactNode;
}) {
  const [openId, setOpenId] = useState<number | null>(null);

  // Lines carry a full path ("Еда/Продукты"), so matching the prefix against a parent
  // picks up its children too: "Еда" shows groceries and alcohol both. The
  // uncategorized node has an empty path, which selects lines with no category at all.
  const visible = filter
    ? rows.filter((r) =>
        filter.path === ""
          ? r.lines.some((l) => l.categoryPath === null)
          : r.lines.some(
              (l) =>
                l.categoryPath === filter.path || l.categoryPath?.startsWith(`${filter.path}/`),
            ),
      )
    : rows;

  // Rows arrive newest first, so insertion order gives days in the right order.
  const byDay = new Map<string, Row[]>();
  for (const row of visible) {
    const key = dayHeading(row.occurredOn);
    byDay.set(key, [...(byDay.get(key) ?? []), row]);
  }

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-xs uppercase tracking-widest text-ink-300">Покупки</h2>
        {filter && (
          <button
            type="button"
            onClick={onClearFilter}
            className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-300 hover:bg-ink-800 hover:text-ink-100"
          >
            {filter.name || "Без категории"} — показать все
          </button>
        )}
      </div>

      {visible.length === 0 && <p className="mt-4 text-sm text-ink-300">Ничего не найдено.</p>}

      {[...byDay.entries()].map(([day, dayRows]) => (
        <div key={day} className="mt-6">
          <div className="flex items-baseline justify-between gap-3 border-b border-ink-700 pb-1">
            <h3 className="text-xs text-ink-300">{day}</h3>
            <span className="tnum text-xs whitespace-nowrap text-ink-300 tabular-nums">
              {money(dayRows.reduce((sum, r) => sum + r.totalMinor, 0))}
            </span>
          </div>

          <ul>
            {dayRows.map((row) => (
              <li key={row.id} className="border-b border-ink-800 last:border-0">
                <button
                  type="button"
                  onClick={() => setOpenId(openId === row.id ? null : row.id)}
                  aria-expanded={openId === row.id}
                  className="flex w-full items-baseline gap-3 py-2 text-left text-sm hover:bg-ink-800/50"
                >
                  <span className="flex-1">{row.merchantRaw ?? "Без названия"}</span>
                  <span className="tnum whitespace-nowrap tabular-nums">
                    −{money(row.totalMinor)}
                  </span>
                </button>

                {/* Amounts appear only on split receipts; a single line just repeats
                    the total already shown above it. */}
                <ul className="pb-2">
                  {row.lines.map((line) => (
                    <li
                      key={line.id}
                      className="flex items-baseline gap-3 pl-4 text-xs text-ink-300"
                    >
                      <span className="flex-1">
                        {line.categoryPath ?? "Без категории"}
                        {line.note && ` · ${line.note}`}
                      </span>
                      {row.lines.length > 1 && (
                        <span className="tnum whitespace-nowrap tabular-nums">
                          {money(line.amountMinor)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>

                {openId === row.id && <div className="pb-3">{renderEditor(row, () => setOpenId(null))}</div>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
