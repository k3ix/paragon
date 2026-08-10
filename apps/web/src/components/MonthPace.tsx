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

  // The bar tracks ordinary living against its budget. A holiday paid this month is
  // real money, but measuring it against a monthly budget it was never part of would
  // show a permanent overrun.
  const used =
    p.budgetMinor && p.budgetMinor > 0
      ? Math.min((p.livingMinor / p.budgetMinor) * 100, 100)
      : null;
  const over = p.budgetMinor !== null && p.livingMinor > p.budgetMinor;

  const parts = [
    { label: "обязательное", value: p.committedMinor },
    { label: "разовое", value: p.occasionalMinor },
    { label: "на жизнь", value: p.livingMinor },
  ].filter((part) => part.value !== 0);

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
      {parts.length > 1 && (
        <ul className="tnum mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {parts.map((part) => (
            <li key={part.label} className="whitespace-nowrap text-ink-300">
              {part.label} <span className="text-ink-100">{money(part.value)}</span>
            </li>
          ))}
        </ul>
      )}

      {used !== null && (
        <>
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-ink-800">
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
