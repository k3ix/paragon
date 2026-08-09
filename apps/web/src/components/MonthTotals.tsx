import type { MonthSummary } from "@paragon/shared";
import { money } from "../lib/format";

export function MonthTotals({ summary }: { summary: MonthSummary }) {
  const cells = [
    { label: "Income", value: summary.incomeMinor, tone: "text-gain" },
    { label: "Spent", value: summary.spentMinor, tone: "text-ink-100" },
    {
      label: "Kept",
      value: summary.keptMinor,
      tone: summary.keptMinor >= 0 ? "text-gain" : "text-drain",
    },
  ];

  return (
    <section className="grid grid-cols-3 gap-4 border-t border-ink-700 pt-6 sm:gap-6">
      {cells.map((cell) => (
        <div key={cell.label}>
          <p className="text-xs uppercase tracking-widest text-ink-300">{cell.label}</p>
          {/*
           * whitespace-nowrap: the thousands separator is a plain space, so a narrow
           * column would otherwise break "10 400.00" across two lines and destroy the
           * alignment the tabular figures exist to provide.
           */}
          <p className={`tnum mt-2 whitespace-nowrap text-xl font-medium sm:text-2xl ${cell.tone}`}>
            {money(cell.value)}
          </p>
          <p className="mt-0.5 text-xs text-ink-300">PLN</p>
        </div>
      ))}
    </section>
  );
}
