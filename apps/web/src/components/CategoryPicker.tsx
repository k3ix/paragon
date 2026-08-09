import type { CategoryNode } from "@paragon/shared";
import { useCategories } from "../api/queries";

/** Flattens the tree into slash-separated paths, preserving order. */
function flatten(nodes: CategoryNode[], prefix = ""): { path: string; depth: number }[] {
  return nodes.flatMap((node) => {
    const path = prefix ? `${prefix}/${node.name}` : node.name;
    return [
      { path, depth: prefix.split("/").filter(Boolean).length },
      ...flatten(node.children, path),
    ];
  });
}

export function CategoryPicker({
  value,
  onChange,
  id,
}: {
  value: string | null;
  onChange: (path: string | null) => void;
  id?: string;
}) {
  const categories = useCategories();
  const options = categories.data ? flatten(categories.data) : [];

  return (
    <select
      id={id}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100"
    >
      <option value="">Uncategorized</option>
      {options.map((option) => (
        <option key={option.path} value={option.path}>
          {" ".repeat(option.depth * 2)}
          {option.path.split("/").at(-1)}
        </option>
      ))}
    </select>
  );
}
