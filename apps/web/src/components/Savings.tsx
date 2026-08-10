import { useSavings, useRunway } from "../api/queries";
import { money } from "../lib/format";

/**
 * What was actually put away this month, and what is left to live on.
 *
 * The point of the whole app: money moved to savings on payday, before spending, is
 * the thing being optimised. It cannot be read off a spending total — transfers are
 * not expenses — so it gets its own block above everything else.
 */
export function Savings({ month }: { month: string }) {
  const savings = useSavings(month);
  const runway = useRunway(month);

  if (!savings.data || !runway.data) return null;
  const s = savings.data;
  const r = runway.data;

  if (s.savedMinor === 0 && r.incomeMinor === 0) return null;

  const peak = Math.max(...s.history.map((h) => h.savedMinor), 1);
  const delta = s.savedMinor - s.previousMinor;

  return (
    <section>
      <h2 className="text-xs uppercase tracking-widest text-ink-300">Отложено</h2>

      <p className="tnum mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-5xl leading-none font-semibold whitespace-nowrap text-gain sm:text-6xl">
          {money(s.savedMinor)} zł
        </span>
        {s.rate !== null && (
          <span className="text-sm text-ink-300">{s.rate}% от дохода</span>
        )}
      </p>

      {s.previousMinor > 0 && delta !== 0 && (
        <p className="tnum mt-2 text-sm text-ink-300">
          <span className={delta > 0 ? "text-gain" : "text-drain"}>
            {delta > 0 ? "+" : "−"}
            {money(Math.abs(delta))}
          </span>{" "}
          к прошлому месяцу
        </p>
      )}

      {s.destinations.length > 0 && (
        <ul className="mt-5 max-w-sm space-y-1.5 text-sm">
          {s.destinations.map((destination) => (
            <li
              key={destination.label}
              className="flex items-baseline justify-between gap-4 border-b border-ink-800 pb-1.5 last:border-0"
            >
              <span className="text-ink-300">{destination.label}</span>
              <span className="tnum whitespace-nowrap tabular-nums">
                {money(destination.amountMinor)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Income minus savings minus spending: the figure the household actually
          operates on once it has paid itself first. */}
      <dl className="mt-6 max-w-sm space-y-2 border-t border-ink-700 pt-4 text-sm">
        <Row label="Пришло" value={money(r.incomeMinor)} />
        <Row label="Отложено" value={`−${money(r.savedMinor)}`} />
        <Row label="Потрачено" value={`−${money(r.spentMinor)}`} />
        <div className="border-t border-ink-700 pt-2">
          <Row label="Осталось" value={money(r.leftMinor)} strong />
        </div>
      </dl>

      {s.history.some((h) => h.savedMinor > 0) && (
        <>
          <div className="mt-6 flex h-12 items-end gap-1" aria-hidden="true">
            {s.history.map((point, index) => (
              <div
                key={point.month}
                style={{ height: `${Math.max((point.savedMinor / peak) * 100, 2)}%` }}
                className={`flex-1 rounded-t-sm ${
                  index === s.history.length - 1 ? "bg-gain" : "bg-gain/30"
                }`}
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-300">
            {s.history[0]!.month} — {s.history.at(-1)!.month}
          </p>
        </>
      )}
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={strong ? "text-ink-100" : "text-ink-300"}>{label}</dt>
      <dd
        className={`tnum whitespace-nowrap tabular-nums ${strong ? "font-semibold" : "text-ink-300"}`}
      >
        {value}
      </dd>
    </div>
  );
}
