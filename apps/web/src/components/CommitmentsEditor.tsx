import { useState } from "react";
import type { CategoryNode } from "@paragon/shared";
import {
  useCommitments,
  useCreateCommitment,
  useEndCommitment,
  useCategories,
} from "../api/queries";
import { CategoryPicker } from "./CategoryPicker";
import { money, currentMonth } from "../lib/format";

/** Finds the category a slash-separated path names, or null if it names nothing. */
function findByPath(nodes: CategoryNode[], path: string | null): CategoryNode | null {
  if (!path) return null;
  const [head, ...rest] = path.split("/");
  const match = nodes.find((n) => n.name === head);
  if (!match) return null;
  return rest.length === 0 ? match : findByPath(match.children, rest.join("/"));
}

/**
 * Declared monthly amounts: the base salary and recurring costs like rent.
 *
 * These cannot be derived from transactions — rent is known before it is paid, and
 * the payday figure is meaningless without it.
 */
export function CommitmentsEditor() {
  const commitments = useCommitments();
  const categories = useCategories();
  const create = useCreateCommitment();
  const end = useEndCommitment();

  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryPath, setCategoryPath] = useState<string | null>(null);

  const active = (commitments.data ?? []).filter((c) => c.activeTo === null);
  const error = create.error ?? end.error;

  const parsedMinor = Math.round(Number(amount.replace(",", ".")) * 100);
  const valid = name.trim().length > 0 && Number.isFinite(parsedMinor) && parsedMinor > 0;

  function submit() {
    if (!valid) return;
    create.mutate(
      {
        kind,
        name: name.trim(),
        amountMinor: parsedMinor,
        // The category links an expense to the tree so it is not counted twice: once
        // as a commitment, once inside the flexible-spending average.
        categoryId:
          kind === "expense" ? (findByPath(categories.data ?? [], categoryPath)?.id ?? null) : null,
        activeFrom: currentMonth(),
      },
      {
        onSuccess: () => {
          setName("");
          setAmount("");
          setCategoryPath(null);
        },
      },
    );
  }

  return (
    <section>
      <h2 className="text-xs uppercase tracking-widest text-ink-300">Постоянные суммы</h2>
      <p className="mt-2 max-w-xl text-sm text-ink-300">
        Зарплата и траты, которые повторяются каждый месяц. Из них считается, сколько можно
        отложить в день зарплаты.
      </p>

      <ul className="mt-5">
        {active.map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink-700 py-2 text-sm last:border-0"
          >
            <span className="min-w-40 flex-1">
              {c.name}
              <span className="ml-2 text-xs text-ink-300">
                {c.kind === "income" ? "доход" : "расход"} · с {c.activeFrom}
              </span>
            </span>
            <span className="tnum whitespace-nowrap tabular-nums">{money(c.amountMinor)}</span>
            <button
              type="button"
              onClick={() => end.mutate({ id: c.id, month: currentMonth() })}
              className="rounded px-2 py-1 text-xs text-ink-300 hover:bg-drain/10 hover:text-drain"
            >
              Прекратить
            </button>
          </li>
        ))}
        {active.length === 0 && (
          <li className="py-2 text-sm text-ink-300">Пока ничего не добавлено.</li>
        )}
      </ul>

      {error && <p className="mt-3 text-sm text-drain">{error.message}</p>}

      <div className="mt-6 flex flex-wrap items-end gap-2 border-t border-ink-700 pt-4">
        <label className="text-xs text-ink-300">
          Что это
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "income" | "expense")}
            className="mt-1 block rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100"
          >
            <option value="expense">Расход</option>
            <option value="income">Зарплата</option>
          </select>
        </label>

        <label className="text-xs text-ink-300">
          Название
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === "income" ? "Зарплата" : "Аренда"}
            className="mt-1 block rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100"
          />
        </label>

        <label className="text-xs text-ink-300">
          Сумма
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder={kind === "income" ? "28000" : "4000"}
            className="tnum mt-1 block w-28 rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100"
          />
        </label>

        {kind === "expense" && (
          <label className="w-48 text-xs text-ink-300">
            Категория
            <span className="mt-1 block">
              <CategoryPicker value={categoryPath} onChange={setCategoryPath} />
            </span>
          </label>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!valid || create.isPending}
          className="rounded bg-gain px-3 py-1.5 text-sm font-medium text-ink-900 disabled:opacity-40"
        >
          Добавить
        </button>
      </div>
    </section>
  );
}
