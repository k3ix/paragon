import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { categories } from "../db/schema";

export type CategoryNode = {
  id: number;
  name: string;
  isFixed: boolean;
  children: CategoryNode[];
};

export function createCategory(input: {
  name: string;
  parentId?: number | null;
  isFixed?: boolean;
}): { id: number; name: string } {
  const row = db
    .insert(categories)
    .values({
      name: input.name,
      parentId: input.parentId ?? null,
      isFixed: input.isFixed ?? false,
    })
    .returning({ id: categories.id, name: categories.name })
    .get();
  return row;
}

/** Returns the active category tree. Archived categories are omitted. */
export function listCategories(): CategoryNode[] {
  const rows = db
    .select({
      id: categories.id,
      name: categories.name,
      parentId: categories.parentId,
      isFixed: categories.isFixed,
    })
    .from(categories)
    .where(isNull(categories.archivedAt))
    .all();

  const byId = new Map<number, CategoryNode>();
  for (const row of rows) {
    byId.set(row.id, { id: row.id, name: row.name, isFixed: row.isFixed, children: [] });
  }

  const roots: CategoryNode[] = [];
  for (const row of rows) {
    const node = byId.get(row.id)!;
    // A child whose parent is archived is treated as a root rather than dropped.
    const parent = row.parentId === null ? undefined : byId.get(row.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  return roots;
}

/**
 * Resolves a slash-separated path such as "Food/Groceries" to a category id.
 *
 * Claude works with names, not ids. Matching walks segment by segment so that a
 * nested name is never mistaken for a root one.
 */
export function findCategoryByPath(path: string): number | null {
  const segments = path
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return null;

  let parentId: number | null = null;
  for (const segment of segments) {
    const row: { id: number } | undefined = db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          sql`lower(${categories.name}) = lower(${segment})`,
          parentId === null ? isNull(categories.parentId) : eq(categories.parentId, parentId),
          isNull(categories.archivedAt),
        ),
      )
      .get();

    if (!row) return null;
    parentId = row.id;
  }

  return parentId;
}
