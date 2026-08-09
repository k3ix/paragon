import { listCategories, type CategoryNode } from "../../services/categories";

export const def = {
  name: "list_categories",
  config: {
    title: "List categories",
    description:
      "Returns the current category tree as indented paths. Call this before recording expenses so that categories match the existing taxonomy instead of inventing new names. Paths are slash-separated, e.g. Food/Groceries.",
  },
};

function render(nodes: CategoryNode[], prefix = ""): string[] {
  return nodes.flatMap((node) => {
    const path = prefix ? `${prefix}/${node.name}` : node.name;
    const label = node.isFixed ? `${path} [fixed]` : path;
    return [label, ...render(node.children, path)];
  });
}

export async function handler() {
  const tree = listCategories();
  const lines = render(tree);

  return {
    content: [
      {
        type: "text" as const,
        text: lines.length
          ? `Categories:\n${lines.join("\n")}`
          : "No categories yet. Create them before recording expenses.",
      },
    ],
  };
}
