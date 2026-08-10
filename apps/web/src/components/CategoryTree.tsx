import { useState } from "react";
import type { CategoryNode } from "@paragon/shared";
import {
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  useArchiveCategory,
} from "../api/queries";

function flatten(nodes: CategoryNode[], depth = 0): { node: CategoryNode; depth: number }[] {
  return nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children, depth + 1)]);
}

export function CategoryTree() {
  const categories = useCategories();
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const archive = useArchiveCategory();

  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");

  const rows = categories.data ? flatten(categories.data) : [];
  const error = create.error ?? update.error ?? archive.error;

  return (
    <section>
      <h2 className="text-xs uppercase tracking-widest text-ink-300">Категории</h2>

      <ul className="mt-4">
        {rows.map(({ node, depth }) => (
          <li
            key={node.id}
            className="flex items-center gap-3 border-b border-ink-700 py-2 text-sm last:border-0"
          >
            <span style={{ paddingLeft: `${depth * 1.25}rem` }} className="flex-1">
              {editingId === node.id ? (
                <input
                  autoFocus
                  value={editingName}
                  aria-label={`Новое название для ${node.name}`}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && editingName.trim()) {
                      update.mutate(
                        { id: node.id, name: editingName.trim() },
                        { onSuccess: () => setEditingId(null) },
                      );
                    }
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1 text-sm"
                />
              ) : (
                <>
                  {node.name}
                  {node.isFixed && (
                    <span className="ml-2 rounded bg-ink-800 px-1.5 py-0.5 text-xs text-ink-300">
                      постоянная
                    </span>
                  )}
                </>
              )}
            </span>

            <select
              value={node.isFixed ? "fixed" : "flexible"}
              onChange={(e) => update.mutate({ id: node.id, isFixed: e.target.value === "fixed" })}
              aria-label={`Тип категории ${node.name}`}
              className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-300"
            >
              <option value="flexible">гибкая</option>
              <option value="fixed">постоянная</option>
            </select>

            <button
              type="button"
              onClick={() => {
                setEditingId(node.id);
                setEditingName(node.name);
              }}
              className="rounded px-2 py-1 text-xs text-ink-300 hover:bg-ink-800"
            >
              Переименовать
            </button>
            <button
              type="button"
              onClick={() => archive.mutate(node.id)}
              className="rounded px-2 py-1 text-xs text-ink-300 hover:bg-drain/10 hover:text-drain"
            >
              В архив
            </button>
          </li>
        ))}
      </ul>

      {error && <p className="mt-3 text-sm text-drain">{error.message}</p>}

      <div className="mt-6 flex flex-wrap items-end gap-2 border-t border-ink-700 pt-4">
        <label className="text-xs text-ink-300">
          Новая категория
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Название"
            className="mt-1 block rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100"
          />
        </label>
        <label className="text-xs text-ink-300">
          Внутри
          <select
            value={newParent ?? ""}
            onChange={(e) => setNewParent(e.target.value ? Number(e.target.value) : null)}
            className="mt-1 block rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100"
          >
            <option value="">Верхний уровень</option>
            {rows.map(({ node, depth }) => (
              <option key={node.id} value={node.id}>
                {" ".repeat(depth * 2)}
                {node.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!newName.trim() || create.isPending}
          onClick={() =>
            create.mutate(
              { name: newName.trim(), parentId: newParent },
              { onSuccess: () => setNewName("") },
            )
          }
          className="rounded bg-gain px-3 py-1.5 text-sm font-medium text-ink-900 disabled:opacity-40"
        >
          Добавить
        </button>
      </div>
    </section>
  );
}
