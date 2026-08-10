import { and, eq, isNull, sql } from "drizzle-orm";
import type { CategoryNode } from "@paragon/shared";
import { db } from "../db";
import { categories } from "../db/schema";

// Shared with the browser: it describes the shape the API returns.
export type { CategoryNode };

export function createCategory(input: {
  name: string;
  parentId?: number | null;
  isFixed?: boolean;
  isOccasional?: boolean;
}): { id: number; name: string } {
  const row = db
    .insert(categories)
    .values({
      name: input.name,
      parentId: input.parentId ?? null,
      isFixed: input.isFixed ?? false,
      isOccasional: input.isOccasional ?? false,
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
      isOccasional: categories.isOccasional,
    })
    .from(categories)
    .where(isNull(categories.archivedAt))
    .all();

  const byId = new Map<number, CategoryNode>();
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      name: row.name,
      isFixed: row.isFixed,
      isOccasional: row.isOccasional,
      children: [],
    });
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

/** True when `candidateParent` is `id` itself or sits beneath it. */
function wouldCreateCycle(id: number, candidateParent: number): boolean {
  if (id === candidateParent) return true;

  const rows = db
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories)
    .all();
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId]));

  const visited = new Set<number>();
  let current: number | null = candidateParent;
  while (current !== null && !visited.has(current)) {
    if (current === id) return true;
    visited.add(current);
    current = parentOf.get(current) ?? null;
  }
  return false;
}

export function updateCategory(
  id: number,
  patch: {
    name?: string;
    parentId?: number | null;
    isFixed?: boolean;
    isOccasional?: boolean;
  },
): { id: number; name: string } {
  const existing = db.select().from(categories).where(eq(categories.id, id)).get();
  if (!existing) throw new Error(`Category not found: ${id}`);

  if (patch.parentId !== undefined && patch.parentId !== null) {
    const parent = db.select().from(categories).where(eq(categories.id, patch.parentId)).get();
    if (!parent) throw new Error(`Parent category not found: ${patch.parentId}`);
    // Depth is unlimited, so a cycle would hang every walk that climbs to a root.
    if (wouldCreateCycle(id, patch.parentId)) {
      throw new Error("That move would create a cycle: a category cannot sit under itself.");
    }
  }

  db.update(categories)
    .set({
      name: patch.name ?? existing.name,
      parentId: patch.parentId === undefined ? existing.parentId : patch.parentId,
      isFixed: patch.isFixed ?? existing.isFixed,
      isOccasional: patch.isOccasional ?? existing.isOccasional,
    })
    .where(eq(categories.id, id))
    .run();

  return { id, name: patch.name ?? existing.name };
}

/**
 * Archives a category instead of deleting it.
 *
 * Deleting would either orphan its line items or cascade them away; both destroy
 * history. An archived category disappears from pickers and keeps resolving in reports.
 */
export function archiveCategory(id: number): { archived: true } {
  const existing = db.select().from(categories).where(eq(categories.id, id)).get();
  if (!existing) throw new Error(`Category not found: ${id}`);

  db.update(categories)
    .set({ archivedAt: Math.floor(Date.now() / 1000) })
    .where(eq(categories.id, id))
    .run();

  return { archived: true };
}
