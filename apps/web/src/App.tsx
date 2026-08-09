import { useState } from "react";
import { useSummary, useTrend, useBreakdown, useTransactions } from "./api/queries";
import { currentMonth } from "./lib/format";
import { MonthPicker } from "./components/MonthPicker";
import { SavingsHeadline } from "./components/SavingsHeadline";
import { MonthTotals } from "./components/MonthTotals";
import { CategoryBreakdown } from "./components/CategoryBreakdown";
import { TrendChart } from "./components/TrendChart";
import { TransactionList } from "./components/TransactionList";
import { TransactionEditor } from "./components/TransactionEditor";
import { CategoryTree } from "./components/CategoryTree";
import { DataActions } from "./components/DataActions";

export function App() {
  const [month, setMonth] = useState(currentMonth);
  const [view, setView] = useState<"dashboard" | "categories">("dashboard");

  const summary = useSummary(month);
  const trend = useTrend(month, 12);
  const breakdown = useBreakdown(month);
  const transactions = useTransactions(month);

  const failed = summary.isError || trend.isError || breakdown.isError || transactions.isError;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-5">
          <h1 className="text-sm uppercase tracking-widest text-ink-300">Paragon</h1>
          <nav className="flex gap-3 text-sm">
            <button
              type="button"
              onClick={() => setView("dashboard")}
              className={view === "dashboard" ? "text-ink-100" : "text-ink-300 hover:text-ink-100"}
            >
              Dashboard
            </button>
            <button
              type="button"
              onClick={() => setView("categories")}
              className={view === "categories" ? "text-ink-100" : "text-ink-300 hover:text-ink-100"}
            >
              Categories
            </button>
          </nav>
        </div>
        {view === "dashboard" && <MonthPicker month={month} onChange={setMonth} />}
      </header>

      {view === "categories" && (
        <div className="mt-10">
          <CategoryTree />
        </div>
      )}

      {view === "dashboard" && failed && (
        <p className="mt-10 text-drain">
          Could not reach the server. Start it with <code>bun run dev</code> in apps/server.
        </p>
      )}

      {view === "dashboard" && !failed && (
        <div className="mt-10 space-y-8">
          {summary.data && trend.data && (
            <SavingsHeadline summary={summary.data} trend={trend.data} />
          )}
          {summary.data && <MonthTotals summary={summary.data} />}
          {breakdown.data && <CategoryBreakdown slices={breakdown.data} />}
          {trend.data && <TrendChart trend={trend.data} />}
          {transactions.data && (
            <TransactionList
              rows={transactions.data.rows}
              renderEditor={(row, close) => <TransactionEditor row={row} onClose={close} />}
            />
          )}
          <DataActions month={month} />
        </div>
      )}
    </main>
  );
}
