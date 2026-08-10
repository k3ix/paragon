import { useState } from "react";
import { formatMinor } from "@paragon/shared";
import { useUpdateTransaction, useDeleteTransaction } from "../api/queries";
import { CategoryPicker } from "./CategoryPicker";

type Line = { id: number; amountMinor: number; categoryPath: string | null; note: string | null };

type Row = {
  id: number;
  occurredOn: number;
  totalMinor: number;
  merchantRaw: string | null;
  note: string | null;
  lines: Line[];
};

/** Unix seconds to the "YYYY-MM-DD" an <input type="date"> expects. */
function isoDate(occurredOn: number): string {
  return new Date(occurredOn * 1000).toISOString().slice(0, 10);
}

export function TransactionEditor({ row, onClose }: { row: Row; onClose: () => void }) {
  const [date, setDate] = useState(isoDate(row.occurredOn));
  const [merchant, setMerchant] = useState(row.merchantRaw ?? "");
  const [note, setNote] = useState(row.note ?? "");
  const [lines, setLines] = useState(
    row.lines.map((l) => ({
      amount: formatMinor(l.amountMinor),
      category: l.categoryPath,
      note: l.note ?? "",
    })),
  );

  const update = useUpdateTransaction();
  const remove = useDeleteTransaction();

  const totalMinor = lines.reduce((sum, l) => {
    const parsed = Number(l.amount.replace(",", "."));
    return sum + (Number.isFinite(parsed) ? Math.round(parsed * 100) : 0);
  }, 0);
  const balanced = totalMinor === row.totalMinor;

  function save() {
    update.mutate(
      {
        id: row.id,
        date,
        merchant: merchant || null,
        note: note || null,
        lineItems: lines.map((l) => ({
          amount: l.amount,
          category: l.category ?? undefined,
          note: l.note || undefined,
        })),
      },
      { onSuccess: onClose },
    );
  }

  const error = update.error ?? remove.error;

  return (
    <div className="border-l-2 border-ink-500 bg-ink-800/40 px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-ink-300">
          Дата
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="tnum mt-1 w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100"
          />
        </label>
        <label className="text-xs text-ink-300 sm:col-span-2">
          Магазин
          <input
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            className="mt-1 w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100"
          />
        </label>
      </div>

      <p className="mt-4 text-xs uppercase tracking-widest text-ink-300">Строки</p>
      <div className="mt-2 space-y-2">
        {lines.map((line, index) => (
          <div key={index} className="grid grid-cols-[1fr_100px_auto] items-center gap-2">
            <CategoryPicker
              value={line.category}
              onChange={(path) =>
                setLines(lines.map((l, i) => (i === index ? { ...l, category: path } : l)))
              }
            />
            <input
              value={line.amount}
              inputMode="decimal"
              aria-label={`Сумма строки ${index + 1}`}
              onChange={(e) =>
                setLines(lines.map((l, i) => (i === index ? { ...l, amount: e.target.value } : l)))
              }
              className="tnum rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-right text-sm text-ink-100"
            />
            <button
              type="button"
              onClick={() => setLines(lines.filter((_, i) => i !== index))}
              aria-label={`Удалить строку ${index + 1}`}
              disabled={lines.length === 1}
              className="rounded px-2 py-1 text-ink-300 hover:bg-ink-700 disabled:opacity-30"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-sm">
        <button
          type="button"
          onClick={() => setLines([...lines, { amount: "0.00", category: null, note: "" }])}
          className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-300 hover:bg-ink-700"
        >
          Добавить строку
        </button>
        {/*
         * Advisory only — the server enforces the invariant. Naming the difference
         * here saves a round trip and tells you which line to fix.
         */}
        <span className={`tnum text-right text-xs ${balanced ? "text-gain" : "text-flag"}`}>
          {balanced
            ? `Сходится: ${formatMinor(row.totalMinor)}`
            : `Строки дают ${formatMinor(totalMinor)}, в чеке ${formatMinor(row.totalMinor)}`}
        </span>
      </div>

      <label className="mt-4 block text-xs text-ink-300">
        Заметка
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1 w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100"
        />
      </label>

      {error && <p className="mt-3 text-sm text-drain">{error.message}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={update.isPending}
          className="rounded bg-gain px-3 py-1.5 text-sm font-medium text-ink-900 disabled:opacity-50"
        >
          {update.isPending ? "Сохраняю…" : "Сохранить"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:bg-ink-700"
        >
          Отмена
        </button>
        <button
          type="button"
          onClick={() => remove.mutate(row.id, { onSuccess: onClose })}
          disabled={remove.isPending}
          className="ml-auto rounded px-3 py-1.5 text-sm text-drain hover:bg-drain/10 disabled:opacity-50"
        >
          Удалить
        </button>
      </div>
    </div>
  );
}
