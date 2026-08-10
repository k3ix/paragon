import type { CategoryTreeNode } from "@paragon/shared";
import { useTree } from "../api/queries";
import { money } from "../lib/format";

/**
 * Spending as a tree, replacing the donut chart.
 *
 * The donut showed four top-level slices and hid the subcategory split — which is the
 * split worth seeing, since groceries and alcohol are different decisions. Nesting is
 * drawn with a rule down the left edge rather than plain indentation: padding alone
 * reads as rows jittering sideways.
 */
export function SpendingTree({
  period,
  selectedPath,
  onSelect,
}: {
  period: string;
  selectedPath: string | null;
  onSelect: (path: string, name: string) => void;
}) {
  const tree = useTree(period);
  if (!tree.data) return null;

  if (tree.data.length === 0) {
    return (
      <section>
        <h2 className="text-xs uppercase tracking-widest text-ink-300">Куда ушли деньги</h2>
        <p className="mt-4 text-sm text-ink-300">За этот период ещё ничего не записано.</p>
      </section>
    );
  }

  const widest = Math.max(...tree.data.map((n) => n.totalMinor), 1);

  return (
    <section>
      <h2 className="text-xs uppercase tracking-widest text-ink-300">Куда ушли деньги</h2>
      <ul className="mt-4">
        {tree.data.map((node) => (
          <Node
            key={node.categoryId ?? "none"}
            node={node}
            widest={widest}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </section>
  );
}

function Node({
  node,
  widest,
  selectedPath,
  onSelect,
  depth = 0,
}: {
  node: CategoryTreeNode;
  widest: number;
  selectedPath: string | null;
  onSelect: (path: string, name: string) => void;
  depth?: number;
}) {
  const selected = selectedPath === node.path;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(node.path, node.name)}
        aria-pressed={selected}
        className={`flex w-full items-baseline gap-3 rounded py-1.5 pr-1 pl-2 text-left hover:bg-ink-800/50 ${
          selected ? "bg-ink-800" : ""
        }`}
      >
        <span className={`flex-1 text-sm ${depth === 0 ? "" : "text-ink-300"}`}>{node.name}</span>

        <span className="tnum w-24 text-right text-sm whitespace-nowrap tabular-nums">
          {money(node.totalMinor)}
        </span>

        <span className="tnum w-9 text-right text-xs text-ink-300 tabular-nums">
          {node.share}%
        </span>

        {/* A delta only says something once the previous month has data to compare. */}
        <span className="tnum hidden w-20 text-right text-xs tabular-nums sm:inline">
          {node.previousMinor > 0 && node.deltaMinor !== 0 && (
            <span className={node.deltaMinor > 0 ? "text-drain" : "text-gain"}>
              {node.deltaMinor > 0 ? "+" : "−"}
              {money(Math.abs(node.deltaMinor))}
            </span>
          )}
        </span>

        <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-ink-800 sm:block">
          <span
            style={{ width: `${Math.max((node.totalMinor / widest) * 100, 2)}%` }}
            className={`block h-full rounded-full ${depth === 0 ? "bg-gain/70" : "bg-gain/35"}`}
          />
        </span>
      </button>

      {node.children.length > 0 && (
        <ul className="ml-3 border-l border-ink-700 pl-2">
          {node.children.map((child) => (
            <Node
              key={child.categoryId ?? "none"}
              node={child}
              widest={widest}
              selectedPath={selectedPath}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
