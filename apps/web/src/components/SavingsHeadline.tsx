import type { MonthSummary, TrendPoint } from "@paragon/shared";
import { money } from "../lib/format";

/**
 * The page's one loud element: the current rate, and immediately beneath it the
 * eleven months before it, so "is this month normal" is answered in a glance
 * rather than by remembering last month's number.
 */
export function SavingsHeadline({
  summary,
  trend,
}: {
  summary: MonthSummary;
  trend: TrendPoint[];
}) {
  const rates = trend.map((p) => p.savingsRate ?? 0);
  const peak = Math.max(...rates.map(Math.abs), 1);
  const previous = trend.at(-2);

  return (
    <section>
      <h2 className="text-xs uppercase tracking-widest text-ink-300">Kept this month</h2>

      <p className="tnum mt-3 text-6xl leading-none font-semibold">
        {summary.savingsRate === null ? (
          <span className="text-ink-300">—</span>
        ) : (
          <span className={summary.savingsRate >= 0 ? "text-gain" : "text-drain"}>
            {summary.savingsRate}%
          </span>
        )}
      </p>

      <p className="tnum mt-3 text-sm text-ink-300">
        {money(summary.keptMinor)} of {money(summary.incomeMinor)} PLN
        {previous !== undefined && previous.savingsRate !== null && (
          <> · previous month {previous.savingsRate}%</>
        )}
      </p>

      <div className="mt-5 flex h-14 items-end gap-1" aria-hidden="true">
        {trend.map((point, index) => {
          const isCurrent = index === trend.length - 1;
          // A month with no income has no rate at all. Drawing it as a zero-height bar
          // would read as "kept nothing" rather than "nothing recorded", so it gets a
          // flat baseline tick instead.
          if (point.savingsRate === null) {
            return <div key={point.month} className="h-px flex-1 rounded-sm bg-ink-700" />;
          }
          const height = Math.max((Math.abs(point.savingsRate) / peak) * 100, 4);
          return (
            <div
              key={point.month}
              style={{ height: `${height}%` }}
              className={`flex-1 rounded-t-sm ${
                isCurrent ? "bg-gain" : point.savingsRate < 0 ? "bg-drain/50" : "bg-gain/35"
              }`}
            />
          );
        })}
      </div>
      <p className="mt-2 text-xs text-ink-300">
        {trend[0]?.month} — {trend.at(-1)?.month}
      </p>
    </section>
  );
}
