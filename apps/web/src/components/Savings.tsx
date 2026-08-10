import { money } from "../lib/format";

type Summary = {
  incomeMinor: number;
  savedMinor: number;
  spentMinor: number;
  leftMinor: number;
  daysRemaining: number;
  perDayLeftMinor: number | null;
};

/**
 * What was put away this period, and what is left to live on.
 *
 * Deliberately just the amount: balances, interest and returns live in the broker's
 * app and the bank's, which do that properly. The only thing this needs to answer is
 * "how much did we manage to move out" — the outcome the whole app exists to improve.
 */
export function Savings({ summary }: { summary: Summary }) {
  const s = summary;
  if (s.incomeMinor === 0 && s.savedMinor === 0) return null;

  const rate = s.incomeMinor > 0 ? Math.round((s.savedMinor / s.incomeMinor) * 100) : null;

  return (
    <section>
      <h2 className="text-xs uppercase tracking-widest text-ink-300">Отложено</h2>

      <p className="tnum mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-5xl leading-none font-semibold whitespace-nowrap text-gain sm:text-6xl">
          {money(s.savedMinor)} zł
        </span>
        {rate !== null && <span className="text-sm text-ink-300">{rate}% от зарплаты</span>}
      </p>

      <dl className="mt-6 max-w-sm space-y-2 text-sm">
        <Row label="Пришло" value={money(s.incomeMinor)} />
        <Row label="Отложено" value={`−${money(s.savedMinor)}`} />
        <Row label="Потрачено" value={`−${money(s.spentMinor)}`} />
        <div className="border-t border-ink-700 pt-2">
          <Row label="Осталось" value={money(s.leftMinor)} strong />
        </div>
      </dl>

      {/* The figure behind "can we order sushi tonight". */}
      {s.perDayLeftMinor !== null && s.daysRemaining > 0 && (
        <p className="tnum mt-3 text-sm text-ink-300">
          {money(s.perDayLeftMinor)} zł в день на оставшиеся {s.daysRemaining} дн.
        </p>
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
