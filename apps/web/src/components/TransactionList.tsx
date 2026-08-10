import { useState, type ReactNode } from "react";
import { money, dayHeading } from "../lib/format";

type Line = {
  id: number;
  amountMinor: number;
  /** What was bought. Null for lines recorded before names existed. */
  name: string | null;
  categoryPath: string | null;
  note: string | null;
};

/**
 * Mirrors `TransactionRow` from `apps/server/src/services/queries.ts`. The type is not
 * in `@paragon/shared` — it reaches the browser through Eden's inferred response type,
 * which cannot be named here without importing the whole app type.
 */
type Row = {
  id: number;
  occurredOn: number;
  /** "expense", "income" or "transfer" — each reads differently and signs differently. */
  type: string;
  totalMinor: number;
  merchantRaw: string | null;
  note: string | null;
  lines: Line[];
};

/** A receipt's lines folded into one row per category, biggest first. */
function byCategory(lines: Line[]): { label: string; amountMinor: number; count: number }[] {
  const groups = new Map<string, { amountMinor: number; count: number }>();
  for (const line of lines) {
    const label = line.categoryPath ?? "Без категории";
    const group = groups.get(label) ?? { amountMinor: 0, count: 0 };
    group.amountMinor += line.amountMinor;
    group.count += 1;
    groups.set(label, group);
  }
  return [...groups.entries()]
    .map(([label, g]) => ({ label, ...g }))
    .sort((a, b) => b.amountMinor - a.amountMinor);
}

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
        <h2 className="text-xs uppercase tracking-widest text-ink-300">Движение денег</h2>
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
          <div className="flex items-baseline justify-between gap-3 border-b border-ink-700 pb-1.5">
            <h3 className="text-xs uppercase tracking-wider text-ink-500">{day}</h3>
            {/* Only spending is subtotalled: adding a salary to a day's shopping
                would produce a figure that means nothing. */}
            <span className="tnum text-xs whitespace-nowrap text-ink-500 tabular-nums">
              {money(
                dayRows
                  .filter((r) => r.type === "expense")
                  .reduce((sum, r) => sum + r.totalMinor, 0),
              )}{" "}
              zł
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
                  <span className="flex-1">
                    {row.merchantRaw ?? "Без названия"}
                    {row.type === "transfer" && (
                      <span className="ml-2 rounded bg-gain/10 px-1.5 py-0.5 text-xs text-gain">
                        вывод
                      </span>
                    )}
                  </span>
                  {/* Income arrives, savings leave for an account you still own, and
                      spending is gone. Three different events, three different marks. */}
                  <span
                    className={`tnum whitespace-nowrap tabular-nums ${
                      row.type === "income"
                        ? "text-gain"
                        : row.type === "transfer"
                          ? "text-ink-100"
                          : ""
                    }`}
                  >
                    {row.type === "income" ? "+" : row.type === "transfer" ? "→ " : "−"}
                    {money(row.totalMinor)} zł
                  </span>
                </button>

                {/*
                 * Collapsed, a receipt shows one line per category — ten items from
                 * one Temu order read as noise, "Одежда 127.35" reads as a fact.
                 * The items themselves are in the editor, one row each.
                 */}
                <ul className="pb-2">
                  {byCategory(row.lines).map((group) => (
                    <li
                      key={group.label}
                      className="flex items-baseline gap-3 pl-4 text-[0.8125rem] text-ink-300"
                    >
                      <span className="flex-1">
                        {group.label}
                        {group.count > 1 && ` · ${group.count} шт`}
                      </span>
                      {row.lines.length > 1 && (
                        <span className="tnum whitespace-nowrap tabular-nums">
                          {money(group.amountMinor)}
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
