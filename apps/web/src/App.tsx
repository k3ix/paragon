import { useState } from "react";
import { useTransactions, usePeriods, usePeriodSummary, useBudget } from "./api/queries";
import { currentMonth } from "./lib/format";
import { PeriodPicker } from "./components/PeriodPicker";
import { Savings } from "./components/Savings";
import { SetAside } from "./components/SetAside";
import { MonthPace } from "./components/MonthPace";
import { SpendingTree } from "./components/SpendingTree";
import { TransactionList } from "./components/TransactionList";
import { TransactionEditor } from "./components/TransactionEditor";
import { CategoryTree } from "./components/CategoryTree";
import { CommitmentsEditor } from "./components/CommitmentsEditor";
import { DataActions } from "./components/DataActions";

/** "2026-08" from a period id, which is either that or "2026-08-10". */
function monthOf(period: string): string {
  return period.startsWith("pay-") ? period.slice(4, 11) : period;
}

export function App() {
  const [period, setPeriod] = useState<string | null>(null);
  const [view, setView] = useState<"dashboard" | "settings">("dashboard");
  const [filter, setFilter] = useState<{ path: string; name: string } | null>(null);

  const periods = usePeriods();

  // Defaults to the current pay period once one exists, since that is the window the
  // money actually moves in. Falls back to the calendar month before any salary is
  // recorded, and after an explicit switch.
  const active: string = period ?? periods.data?.[0]?.id ?? currentMonth();
  const month = monthOf(active);

  const summary = usePeriodSummary(active);
  const budget = useBudget(month);
  const transactions = useTransactions(active);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-5">
          <h1 className="text-sm uppercase tracking-widest text-ink-300">Paragon</h1>
          <nav className="flex gap-3 text-sm">
            <button
              type="button"
              onClick={() => setView("dashboard")}
              className={view === "dashboard" ? "text-ink-100" : "text-ink-300 hover:text-ink-100"}
            >
              Деньги
            </button>
            <button
              type="button"
              onClick={() => setView("settings")}
              className={view === "settings" ? "text-ink-100" : "text-ink-300 hover:text-ink-100"}
            >
              Настройки
            </button>
          </nav>
        </div>
        {view === "dashboard" && (
          <PeriodPicker period={active} periods={periods.data ?? []} onChange={setPeriod} />
        )}
      </header>

      {view === "settings" && (
        <div className="mt-10 space-y-12">
          <CommitmentsEditor />
          <CategoryTree />
        </div>
      )}

      {view === "dashboard" && transactions.isError && (
        <p className="mt-10 text-drain">
          Сервер не отвечает. Запустите его: <code>bun run dev</code> в apps/server.
        </p>
      )}

      {view === "dashboard" && !transactions.isError && (
        <div className="mt-10 space-y-12">
          {/* What actually went into savings comes before what the plan says should:
              the fact is the outcome being optimised, the plan is advice about it. */}
          {summary.data && <Savings summary={summary.data} />}
          <SetAside month={month} />
          {summary.data && (
            <MonthPace summary={summary.data} budgetMinor={budget.data?.flexibleAverageMinor ?? null} />
          )}
          <SpendingTree
            period={active}
            selectedPath={filter?.path ?? null}
            onSelect={(path, name) => setFilter((f) => (f?.path === path ? null : { path, name }))}
          />
          {transactions.data && (
            <TransactionList
              rows={transactions.data.rows}
              filter={filter}
              onClearFilter={() => setFilter(null)}
              renderEditor={(row, close) => <TransactionEditor row={row} onClose={close} />}
            />
          )}
          <DataActions month={month} />
        </div>
      )}
    </main>
  );
}
