import { monthLabel, shiftMonth } from "../lib/format";

export function MonthPicker({
  month,
  onChange,
}: {
  month: string;
  onChange: (month: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-ink-100">{monthLabel(month)}</span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onChange(shiftMonth(month, -1))}
          aria-label="Previous month"
          className="rounded px-2 py-1 text-ink-300 hover:bg-ink-800 hover:text-ink-100"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => onChange(shiftMonth(month, 1))}
          aria-label="Next month"
          className="rounded px-2 py-1 text-ink-300 hover:bg-ink-800 hover:text-ink-100"
        >
          ›
        </button>
      </div>
    </div>
  );
}
