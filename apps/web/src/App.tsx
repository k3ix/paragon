import { useState } from "react";
import { useSummary, useTrend, useBreakdown, useTransactions } from "./api/queries";
import { currentMonth } from "./lib/format";
import { MonthPicker } from "./components/MonthPicker";
import { SavingsHeadline } from "./components/SavingsHeadline";
import { MonthTotals } from "./components/MonthTotals";
import { CategoryBreakdown } from "./components/CategoryBreakdown";
import { TrendChart } from "./components/TrendChart";
import { TransactionList } from "./components/TransactionList";

export function App() {
  const [month, setMonth] = useState(currentMonth);

  const summary = useSummary(month);
  const trend = useTrend(month, 12);
  const breakdown = useBreakdown(month);
  const transactions = useTransactions(month);

  const failed = summary.isError || trend.isError || breakdown.isError || transactions.isError;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-baseline justify-between">
        <h1 className="text-sm uppercase tracking-widest text-ink-300">Paragon</h1>
        <MonthPicker month={month} onChange={setMonth} />
      </header>

      {failed && (
        <p className="mt-10 text-drain">
          Could not reach the server. Start it with <code>bun run dev</code> in apps/server.
        </p>
      )}

      {!failed && (
        <div className="mt-10 space-y-8">
          {summary.data && trend.data && (
            <SavingsHeadline summary={summary.data} trend={trend.data} />
          )}
          {summary.data && <MonthTotals summary={summary.data} />}
          {breakdown.data && <CategoryBreakdown slices={breakdown.data} />}
          {trend.data && <TrendChart trend={trend.data} />}
          {transactions.data && <TransactionList rows={transactions.data.rows} />}
        </div>
      )}
    </main>
  );
}
