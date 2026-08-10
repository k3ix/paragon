import { useState } from "react";
import { money } from "../lib/format";

type Part = { label: string; amountMinor: number };

type Summary = {
  spentMinor: number;
  committedMinor: number;
  occasionalMinor: number;
  livingMinor: number;
  committedParts: Part[];
  occasionalParts: Part[];
  livingParts: Part[];
  perDayMinor: number | null;
};

/** Parts shown before the rest collapses behind "и ещё N". */
const SHOWN = 3;

/**
 * What the spending was made of.
 *
 * The totals live above, in the three-way split of the paycheque; repeating them here
 * as a second headline said the same thing twice. This is only the detail: which
 * shops, in which bucket, with the tail behind a click.
 */
export function MonthPace({
  summary,
  budgetMinor,
}: {
  summary: Summary;
  budgetMinor: number | null;
}) {
  const p = summary;
  if (p.spentMinor === 0) return null;

  // The bar tracks ordinary living against its budget. A holiday paid this period is
  // real money, but measuring it against a monthly budget it was never part of would
  // show a permanent overrun.
  const used =
    budgetMinor && budgetMinor > 0 ? Math.min((p.livingMinor / budgetMinor) * 100, 100) : null;
  const over = budgetMinor !== null && p.livingMinor > budgetMinor;

  const groups = [
    { key: "committed", label: "обязательное", value: p.committedMinor, parts: p.committedParts },
    { key: "occasional", label: "разовое", value: p.occasionalMinor, parts: p.occasionalParts },
    { key: "living", label: "на жизнь", value: p.livingMinor, parts: p.livingParts },
  ].filter((group) => group.value !== 0);

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-xs uppercase tracking-widest text-ink-300">Из чего сложилось</h2>
        {p.perDayMinor !== null && (
          <span className="tnum text-sm text-ink-300">
            {money(p.perDayMinor)} zł в день на жизнь
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-6 sm:grid-cols-3">
        {groups.map((group) => (
          <Group key={group.key} label={group.label} value={group.value} parts={group.parts} />
        ))}
      </div>

      {used !== null && (
        <>
          <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
            <div
              style={{ width: `${used}%` }}
              className={`h-full rounded-full ${over ? "bg-drain" : "bg-gain"}`}
            />
          </div>
          <p className="tnum mt-2 text-xs text-ink-300">
            на жизнь {money(p.livingMinor)} из {money(budgetMinor!)} zł
          </p>
        </>
      )}
    </section>
  );
}

/**
 * A subtotal with the purchases behind it.
 *
 * The largest few are always visible — for one-off spending that is usually the whole
 * story — and the tail expands on demand rather than turning the page into a list.
 */
function Group({ label, value, parts }: { label: string; value: number; parts: Part[] }) {
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? parts : parts.slice(0, SHOWN);
  const hidden = parts.length - visible.length;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 border-b border-ink-700 pb-1.5">
        <span className="text-xs text-ink-300">{label}</span>
        <span className="tnum text-sm whitespace-nowrap tabular-nums">{money(value)} zł</span>
      </div>

      <ul className="mt-2 space-y-1">
        {visible.map((part) => (
          <li
            key={part.label}
            className="flex items-baseline justify-between gap-2 text-xs text-ink-300"
          >
            <span className="truncate">{part.label}</span>
            <span className="tnum whitespace-nowrap tabular-nums">{money(part.amountMinor)}</span>
          </li>
        ))}
      </ul>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1.5 text-xs text-ink-300 underline decoration-ink-700 underline-offset-2 hover:text-ink-100"
        >
          и ещё {hidden}
        </button>
      )}

      {expanded && parts.length > SHOWN && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-1.5 text-xs text-ink-300 underline decoration-ink-700 underline-offset-2 hover:text-ink-100"
        >
          свернуть
        </button>
      )}
    </div>
  );
}
