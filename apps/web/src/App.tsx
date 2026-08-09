import { useState } from "react";
import { useSummary } from "./api/queries";
import { currentMonth, money } from "./lib/format";

export function App() {
  const [month] = useState(currentMonth);
  const summary = useSummary(month);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-sm uppercase tracking-widest text-ink-300">Paragon</h1>
      {summary.isLoading && <p className="mt-8 text-ink-300">Loading…</p>}
      {summary.isError && <p className="mt-8 text-drain">Could not reach the server.</p>}
      {summary.data && (
        <p className="tnum mt-8 text-5xl font-semibold">
          {summary.data.savingsRate === null ? "—" : `${summary.data.savingsRate}%`}
        </p>
      )}
      {summary.data && (
        <p className="tnum mt-2 text-ink-300">
          {money(summary.data.keptMinor)} of {money(summary.data.incomeMinor)} PLN
        </p>
      )}
    </main>
  );
}
