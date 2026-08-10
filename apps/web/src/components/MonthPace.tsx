import { usePace } from "../api/queries";
import { money } from "../lib/format";

/**
 * How the month is going: total, daily rate, and — once a budget exists — a bar
 * showing how much of it is used.
 *
 * Replaces the income/spending line chart, which drew a flat line and a vertical
 * cliff because income arrives once a month.
 */
export function MonthPace({ month }: { month: string }) {
  const pace = usePace(month);
  if (!pace.data) return null;
  const p = pace.data;

  const used =
    p.budgetMinor && p.budgetMinor > 0
      ? Math.min((p.spentMinor / p.budgetMinor) * 100, 100)
      : null;
  const over = p.budgetMinor !== null && p.spentMinor > p.budgetMinor;

  return (
    <section>
      <h2 className="text-xs uppercase tracking-widest text-ink-300">Потрачено</h2>

      <p className="tnum mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-3xl font-semibold whitespace-nowrap">{money(p.spentMinor)} zł</span>
        {p.perDayMinor !== null && (
          <span className="text-sm text-ink-300">
            {money(p.perDayMinor)} zł в день
            {p.daysRemaining > 0 && ` · осталось ${p.daysRemaining} дн.`}
          </span>
        )}
      </p>

      {used !== null && (
        <>
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-ink-800">
            <div
              style={{ width: `${used}%` }}
              className={`h-full rounded-full ${over ? "bg-drain" : "bg-gain"}`}
            />
          </div>
          <p className="tnum mt-2 text-xs text-ink-300">
            из {money(p.budgetMinor!)} zł на жизнь
            {p.projectedMinor !== null && ` · к концу месяца выйдет ${money(p.projectedMinor)}`}
          </p>
        </>
      )}
    </section>
  );
}
