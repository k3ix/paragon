import { monthLabel, shiftMonth } from "../lib/format";

type PayPeriod = { id: string; label: string; open: boolean };

/**
 * The period being reported, as the page's heading.
 *
 * It used to sit in the corner at the same size as everything else, which made the
 * one label that qualifies every figure below it the hardest thing to notice. Reading
 * the wrong period means reading the wrong numbers.
 */
export function PeriodPicker({
  period,
  periods,
  daysElapsed,
  daysTotal,
  onChange,
}: {
  period: string;
  periods: PayPeriod[];
  daysElapsed: number | null;
  daysTotal: number | null;
  onChange: (period: string) => void;
}) {
  const isMonth = /^\d{4}-\d{2}$/.test(period);
  const index = periods.findIndex((p) => p.id === period);
  const current = periods[index];

  const elapsed =
    daysElapsed !== null && daysTotal !== null && daysTotal > 0
      ? Math.min((daysElapsed / daysTotal) * 100, 100)
      : null;

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div>
        <h2 className="text-2xl leading-none font-semibold sm:text-3xl">
          {isMonth ? monthLabel(period) : (current?.label ?? period)}
        </h2>

        {/* How far through the period we are — the question behind "how long does
            this money have to last" — rather than a figure buried in a caption. */}
        {elapsed !== null && (
          <div className="mt-3 flex items-center gap-3">
            <div className="h-1 w-40 overflow-hidden rounded-full bg-ink-800">
              <div style={{ width: `${elapsed}%` }} className="h-full rounded-full bg-ink-500" />
            </div>
            <span className="tnum text-xs text-ink-300">
              день {daysElapsed} из {daysTotal}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        {periods.length > 0 && (
          <div className="flex rounded border border-ink-700 text-xs">
            <button
              type="button"
              onClick={() => onChange(periods[0]!.id)}
              className={`rounded-l px-2.5 py-1.5 ${
                isMonth ? "text-ink-300 hover:text-ink-100" : "bg-ink-800 text-ink-100"
              }`}
            >
              От зарплаты
            </button>
            <button
              type="button"
              onClick={() => onChange(new Date().toISOString().slice(0, 7))}
              className={`rounded-r px-2.5 py-1.5 ${
                isMonth ? "bg-ink-800 text-ink-100" : "text-ink-300 hover:text-ink-100"
              }`}
            >
              Месяц
            </button>
          </div>
        )}

        <div className="flex gap-1">
          <button
            type="button"
            onClick={() =>
              // Pay periods are ordered newest first, so "previous" moves forward
              // through the list.
              onChange(isMonth ? shiftMonth(period, -1) : (periods[index + 1]?.id ?? period))
            }
            disabled={!isMonth && index >= periods.length - 1}
            aria-label="Предыдущий период"
            className="rounded px-2 py-1 text-ink-300 hover:bg-ink-800 hover:text-ink-100 disabled:opacity-30"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() =>
              onChange(isMonth ? shiftMonth(period, 1) : (periods[index - 1]?.id ?? period))
            }
            disabled={!isMonth && index <= 0}
            aria-label="Следующий период"
            className="rounded px-2 py-1 text-ink-300 hover:bg-ink-800 hover:text-ink-100 disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
}
