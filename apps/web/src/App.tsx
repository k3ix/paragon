import { useState } from "react";
import { useTransactions } from "./api/queries";
import { currentMonth } from "./lib/format";
import { MonthPicker } from "./components/MonthPicker";
import { SetAside } from "./components/SetAside";
import { MonthPace } from "./components/MonthPace";
import { SpendingTree } from "./components/SpendingTree";
import { TransactionList } from "./components/TransactionList";
import { TransactionEditor } from "./components/TransactionEditor";
import { CategoryTree } from "./components/CategoryTree";
import { CommitmentsEditor } from "./components/CommitmentsEditor";
import { DataActions } from "./components/DataActions";

export function App() {
  const [month, setMonth] = useState(currentMonth);
  const [view, setView] = useState<"dashboard" | "settings">("dashboard");
  const [filter, setFilter] = useState<{ path: string; name: string } | null>(null);

  const transactions = useTransactions(month);

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
              Месяц
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
        {view === "dashboard" && <MonthPicker month={month} onChange={setMonth} />}
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
          <SetAside month={month} />
          <MonthPace month={month} />
          <SpendingTree
            month={month}
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
