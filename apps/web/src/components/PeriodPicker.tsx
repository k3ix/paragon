import { monthLabel, shiftMonth } from "../lib/format";

type PayPeriod = { id: string; label: string; open: boolean };

/**
 * Switches between a calendar month and a pay period.
 *
 * Both are worth having: a month answers "what did August cost", a pay period answers
 * "how are we doing on this paycheque". The second is the one that matches how the
 * money moves — salary lands, savings go out, the rest has to last — so it leads.
 */
export function PeriodPicker({
  period,
  periods,
  onChange,
}: {
  period: string;
  periods: PayPeriod[];
  onChange: (period: string) => void;
}) {
  const isMonth = /^\d{4}-\d{2}$/.test(period);
  const index = periods.findIndex((p) => p.id === period);
  const current = periods[index];

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {periods.length > 0 && (
        <div className="flex rounded border border-ink-700 text-xs">
          <button
            type="button"
            onClick={() => onChange(periods[0]!.id)}
            className={`rounded-l px-2 py-1 ${
              isMonth ? "text-ink-300 hover:text-ink-100" : "bg-ink-800 text-ink-100"
            }`}
          >
            От зарплаты
          </button>
          <button
            type="button"
            onClick={() => onChange(new Date().toISOString().slice(0, 7))}
            className={`rounded-r px-2 py-1 ${
              isMonth ? "bg-ink-800 text-ink-100" : "text-ink-300 hover:text-ink-100"
            }`}
          >
            Месяц
          </button>
        </div>
      )}

      <div className="flex items-center gap-3">
        <span className="text-sm text-ink-100">
          {isMonth ? monthLabel(period) : (current?.label ?? period)}
        </span>

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
            onClick={() => onChange(isMonth ? shiftMonth(period, 1) : (periods[index - 1]?.id ?? period))}
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
