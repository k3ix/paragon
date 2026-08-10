import { useState } from "react";
import { usePace } from "../api/queries";
import { money } from "../lib/format";

type Part = { label: string; amountMinor: number };

/** Parts shown before the rest collapses behind "и ещё N". */
const SHOWN = 3;

/**
 * How the month is going: the total, what it is made of, and — once a budget exists —
 * a bar showing how much of ordinary living is used.
 *
 * Replaces the income/spending line chart, which drew a flat line and a vertical
 * cliff because income arrives once a month.
 */
export function MonthPace({ month }: { month: string }) {
  const pace = usePace(month);
  if (!pace.data) return null;
  const p = pace.data;

  // The bar tracks ordinary living against its budget. A holiday paid this month is
  // real money, but measuring it against a monthly budget it was never part of would
  // show a permanent overrun.
  const used =
    p.budgetMinor && p.budgetMinor > 0 ? Math.min((p.livingMinor / p.budgetMinor) * 100, 100) : null;
  const over = p.budgetMinor !== null && p.livingMinor > p.budgetMinor;

  const groups = [
    { key: "committed", label: "обязательное", value: p.committedMinor, parts: p.committedParts },
    {
      key: "occasional",
      label: "разовое",
      value: p.occasionalMinor,
      parts: p.occasionalParts,
    },
    { key: "living", label: "на жизнь", value: p.livingMinor, parts: p.livingParts },
  ].filter((group) => group.value !== 0);

  return (
    <section>
      <h2 className="text-xs uppercase tracking-widest text-ink-300">Потрачено</h2>

      <p className="tnum mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-3xl font-semibold whitespace-nowrap">{money(p.spentMinor)} zł</span>
        {p.perDayMinor !== null && (
          <span className="text-sm text-ink-300">
            {money(p.perDayMinor)} zł в день на жизнь
            {p.daysRemaining > 0 && ` · осталось ${p.daysRemaining} дн.`}
          </span>
        )}
      </p>

      {/* The whole sum stays visible and is then accounted for, rather than three
          separate figures that never add up to what left the account. */}
      {groups.length > 1 && (
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {groups.map((group) => (
            <Group
              key={group.key}
              label={group.label}
              value={group.value}
              parts={group.parts}
            />
          ))}
        </div>
      )}

      {used !== null && (
        <>
          <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-ink-800">
            <div
              style={{ width: `${used}%` }}
              className={`h-full rounded-full ${over ? "bg-drain" : "bg-gain"}`}
            />
          </div>
          <p className="tnum mt-2 text-xs text-ink-300">
            на жизнь {money(p.livingMinor)} из {money(p.budgetMinor!)} zł
            {p.projectedMinor !== null && ` · к концу месяца выйдет ${money(p.projectedMinor)}`}
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
      <div className="flex items-baseline justify-between gap-2 border-b border-ink-700 pb-1">
        <span className="text-xs text-ink-300">{label}</span>
        <span className="tnum text-sm whitespace-nowrap tabular-nums">{money(value)}</span>
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
          className="mt-1 text-xs text-ink-300 underline decoration-ink-700 underline-offset-2 hover:text-ink-100"
        >
          и ещё {hidden}
        </button>
      )}

      {expanded && parts.length > SHOWN && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-1 text-xs text-ink-300 underline decoration-ink-700 underline-offset-2 hover:text-ink-100"
        >
          свернуть
        </button>
      )}
    </div>
  );
}
