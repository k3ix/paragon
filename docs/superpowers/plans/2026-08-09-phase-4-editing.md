# Paragon Phase 4 — Editing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a wrong amount, move a purchase to the right category, split a receipt, rename a category — from the page, without opening a chat.

**Architecture:** Write services are added beside the existing read ones and exposed as HTTP mutations. The line-sum invariant, currently buried inside `addOne`, is extracted so editing cannot produce a receipt whose lines disagree with its total. The frontend gets inline editing on the transaction list; TanStack Query invalidation keeps the dashboard in step.

**Tech Stack:** Unchanged — Bun, Elysia, Drizzle, React 19, TanStack Query, `bun:test`.

## Global Constraints

Everything from phases 1–3 still holds:

- **MCP tools and HTTP routes never import `db` or Drizzle.** Both call `src/services/`.
- **Tests run against a separate database file** via `test/helpers/db.ts`.
- **Money is an integer in minor units**; the browser never computes aggregates.
- **Dates are integer Unix seconds.** Months are validated through `src/services/month.ts`.
- **Migrations are versioned files.** Never `db:push`.
- **Category depth is unlimited.**
- **`onError` in `app.ts` sets a status but returns no body** — returning one widens every route's response type and breaks the typed client.

New to this phase:

- **Every write goes through a service that enforces the invariant.** A route that assembles line items itself is a defect.
- **A failed edit changes nothing.** Multi-row writes run inside `db.transaction`.
- **`app.handle()` needs a real hostname.** `new Request("http://x/api/...")` returns 404 no matter how the route is defined — Elysia does not match an arbitrary host. Use `http://localhost/...`, as the existing tests do. This costs an hour to rediscover from a 404 that looks like a routing bug.

## What already exists

- `src/services/transactions.ts` — `addTransactions`; the sum check lives inside `addOne` at line ~99 and must be extracted rather than copied.
- `src/services/categories.ts` — `createCategory`, `listCategories`, `findCategoryByPath`.
- `src/services/merchants.ts` — `getMerchant`, `listMerchants`, `setMerchantCategory`.
- `src/services/queries.ts` — `listTransactions` returning rows with their lines.
- `apps/web/src/api/queries.ts` — read hooks only; no mutations yet.

## File Structure

```
apps/server/src/services/
  invariants.ts                NEW — the shared line-sum check
  transactions.ts              MODIFY — use invariants.ts; add update and delete
  categories.ts                MODIFY — add updateCategory, archiveCategory

apps/server/src/app.ts         MODIFY — PATCH/DELETE routes

apps/web/src/
  api/queries.ts               MODIFY — mutation hooks
  components/TransactionList.tsx   MODIFY — expandable rows
  components/TransactionEditor.tsx NEW — the edit form
  components/CategoryPicker.tsx    NEW — flattened tree selector
  components/CategoryTree.tsx      NEW — view and rename
  App.tsx                      MODIFY — tabs

apps/server/test/
  editing.test.ts              NEW
  routes-editing.test.ts       NEW
```

---

### Task 1: Extract the line-sum invariant

**Files:**
- Create: `apps/server/src/services/invariants.ts`
- Modify: `apps/server/src/services/transactions.ts`
- Test: existing `test/transactions.test.ts` must keep passing

**Interfaces:**
- Produces: from `src/services/invariants.ts`:

```typescript
export type ResolvedLine = { amountMinor: number; categoryId: number | null; note: string | null };
export function resolveLines(
  lines: { amount: string | number; category?: string; note?: string }[] | undefined,
  fallbackTotal: string | number,
): ResolvedLine[];
export function assertLinesMatchTotal(lines: ResolvedLine[], totalMinor: number): void;
```

Editing needs the same two rules that creation needs. Copying them would let the two paths drift, and the drift would be silent — a receipt whose lines no longer sum to its total corrupts every category figure that reads it.

- [ ] **Step 1: Write the module**

`apps/server/src/services/invariants.ts`:

```typescript
import { parseAmountToMinor } from "../money";
import { findCategoryByPath } from "./categories";

export type ResolvedLine = {
  amountMinor: number;
  categoryId: number | null;
  note: string | null;
};

export type LineInput = {
  amount: string | number;
  category?: string;
  note?: string;
};

/**
 * Turns submitted line items into resolved rows.
 *
 * With no breakdown, one uncategorized line covers the whole amount: a push
 * notification carries a total but no receipt, and the category comes later.
 */
export function resolveLines(
  lines: LineInput[] | undefined,
  fallbackTotal: string | number,
): ResolvedLine[] {
  const source: LineInput[] = lines?.length
    ? lines
    : [{ amount: fallbackTotal, category: undefined, note: undefined }];

  return source.map((line) => {
    const amountMinor = parseAmountToMinor(line.amount);
    if (!line.category) {
      return { amountMinor, categoryId: null, note: line.note ?? null };
    }
    const categoryId = findCategoryByPath(line.category);
    if (categoryId === null) {
      throw new Error(`Unknown category path: ${line.category}`);
    }
    return { amountMinor, categoryId, note: line.note ?? null };
  });
}

/**
 * The core invariant: a receipt's lines must account for exactly its total.
 *
 * Enforced on creation and on every edit. Without it an edited receipt can leave
 * the two disagreeing, and every category total that reads those lines is then wrong
 * with nothing to signal it.
 */
export function assertLinesMatchTotal(lines: ResolvedLine[], totalMinor: number): void {
  const sum = lines.reduce((acc, line) => acc + line.amountMinor, 0);
  if (sum !== totalMinor) {
    throw new Error(
      `Line items sum (${sum}) does not match the total (${totalMinor}). ` +
        `Difference: ${totalMinor - sum} minor units.`,
    );
  }
}
```

- [ ] **Step 2: Use it in `addOne`**

In `apps/server/src/services/transactions.ts`, add the import:

```typescript
import { resolveLines, assertLinesMatchTotal } from "./invariants";
```

Replace the block that builds `lines`, maps `resolved`, and throws on mismatch — from `const lines = item.lineItems?.length` through the closing brace of the `if (sum !== totalMinor)` check — with:

```typescript
  const resolved = resolveLines(item.lineItems, item.total);
  assertLinesMatchTotal(resolved, totalMinor);
```

Remove the now-unused `parseAmountToMinor` import if nothing else in the file uses it, and drop `findCategoryByPath` if it became unused.

- [ ] **Step 3: Verify nothing regressed**

Run: `cd apps/server && bun test && bunx tsc --noEmit`
Expected: 113 tests pass, tsc exits 0. The behaviour is unchanged; only its location moved.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/services/invariants.ts apps/server/src/services/transactions.ts
git commit -m "refactor: extract the line-sum invariant for reuse in editing"
```

---

### Task 2: Transaction write services

**Files:**
- Modify: `apps/server/src/services/transactions.ts`
- Test: `apps/server/test/editing.test.ts`

**Interfaces:**
- Produces, from `src/services/transactions.ts`:

```typescript
export function updateTransaction(
  id: number,
  patch: {
    date?: string;
    total?: string | number;
    type?: "expense" | "income" | "transfer";
    merchant?: string | null;
    note?: string | null;
    lineItems?: { amount: string | number; category?: string; note?: string }[];
  },
): TransactionRow;

export function deleteTransaction(id: number): { deleted: true };
```

`updateTransaction` returns the full updated row so the client can render without a refetch.

Two rules that are easy to get wrong:

- Changing the total **without** sending lines rewrites the single implicit line. Changing it while several lines exist is rejected — the server cannot guess which line absorbs the difference.
- Changing the date, total or merchant recomputes `dedup_hash`. Without that, an edit could produce a row that duplicates an existing one.

- [ ] **Step 1: Write the failing test**

`apps/server/test/editing.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "bun:test";
import { resetTestDb, db, schema } from "./helpers/db";
import { createCategory } from "../src/services/categories";
import { addTransactions, updateTransaction, deleteTransaction } from "../src/services/transactions";
import { listTransactions } from "../src/services/queries";

beforeEach(() => {
  resetTestDb();
});

function seed() {
  const food = createCategory({ name: "Food" });
  createCategory({ name: "Groceries", parentId: food.id });
  const home = createCategory({ name: "Home" });
  createCategory({ name: "Cleaning", parentId: home.id });
}

function one(merchant = "Shop", total = "100.00", category = "Food/Groceries") {
  addTransactions([
    { date: "2026-08-09", total, merchant, lineItems: [{ amount: total, category }] },
  ]);
  return listTransactions({}).rows[0]!;
}

describe("updateTransaction", () => {
  it("changes the note", () => {
    const tx = one();
    const updated = updateTransaction(tx.id, { note: "reimbursed" });
    expect(updated.note).toBe("reimbursed");
  });

  it("changes the merchant and keeps the raw spelling", () => {
    const tx = one();
    const updated = updateTransaction(tx.id, { merchant: "Biedronka" });
    expect(updated.merchantRaw).toBe("Biedronka");
  });

  it("changes the date", () => {
    const tx = one();
    const updated = updateTransaction(tx.id, { date: "2026-08-15" });
    expect(updated.occurredOn).toBe(Math.floor(Date.UTC(2026, 7, 15) / 1000));
  });

  it("rewrites the single line when the total changes", () => {
    const tx = one("Shop", "100.00");
    const updated = updateTransaction(tx.id, { total: "120.00" });
    expect(updated.totalMinor).toBe(12000);
    expect(updated.lines).toHaveLength(1);
    expect(updated.lines[0]!.amountMinor).toBe(12000);
  });

  it("refuses to change the total alone when several lines exist", () => {
    addTransactions([
      {
        date: "2026-08-09",
        total: "100.00",
        merchant: "Split",
        lineItems: [
          { amount: "60.00", category: "Food/Groceries" },
          { amount: "40.00", category: "Home/Cleaning" },
        ],
      },
    ]);
    const tx = listTransactions({}).rows[0]!;

    expect(() => updateTransaction(tx.id, { total: "120.00" })).toThrow(/line items/i);
  });

  it("replaces the lines when they are supplied", () => {
    const tx = one("Shop", "100.00");
    const updated = updateTransaction(tx.id, {
      total: "100.00",
      lineItems: [
        { amount: "70.00", category: "Food/Groceries" },
        { amount: "30.00", category: "Home/Cleaning" },
      ],
    });

    expect(updated.lines).toHaveLength(2);
    expect(updated.lines.map((l) => l.amountMinor).sort((a, b) => a - b)).toEqual([3000, 7000]);
  });

  it("rejects lines that do not sum to the total", () => {
    const tx = one("Shop", "100.00");
    expect(() =>
      updateTransaction(tx.id, {
        lineItems: [{ amount: "60.00", category: "Food/Groceries" }],
      }),
    ).toThrow(/does not match/i);
  });

  it("leaves the row untouched when the edit is rejected", () => {
    const tx = one("Shop", "100.00");
    try {
      updateTransaction(tx.id, { lineItems: [{ amount: "60.00", category: "Food/Groceries" }] });
    } catch {
      // expected
    }

    const after = listTransactions({}).rows[0]!;
    expect(after.totalMinor).toBe(10000);
    expect(after.lines).toHaveLength(1);
    expect(after.lines[0]!.amountMinor).toBe(10000);
  });

  it("rejects an unknown category path", () => {
    const tx = one();
    expect(() =>
      updateTransaction(tx.id, {
        lineItems: [{ amount: "100.00", category: "Nope/Missing" }],
      }),
    ).toThrow(/category/i);
  });

  it("recomputes the dedup hash when the amount changes", () => {
    const tx = one("Shop", "100.00");
    const before = db
      .select()
      .from(schema.transactions)
      .all()
      .find((t) => t.id === tx.id)!.dedupHash;

    updateTransaction(tx.id, { total: "120.00" });

    const after = db
      .select()
      .from(schema.transactions)
      .all()
      .find((t) => t.id === tx.id)!.dedupHash;
    expect(after).not.toBe(before);
  });

  it("refuses an edit that would duplicate another transaction", () => {
    seed();
    addTransactions([
      {
        date: "2026-08-09",
        total: "50.00",
        merchant: "Żabka",
        lineItems: [{ amount: "50.00", category: "Food/Groceries" }],
      },
      {
        date: "2026-08-09",
        total: "70.00",
        merchant: "Żabka",
        lineItems: [{ amount: "70.00", category: "Food/Groceries" }],
      },
    ]);
    const rows = listTransactions({}).rows;
    const target = rows.find((r) => r.totalMinor === 7000)!;

    // Making the second one identical to the first would collide on dedup_hash.
    expect(() => updateTransaction(target.id, { total: "50.00" })).toThrow(/already exists/i);
  });

  it("rejects an unknown transaction id", () => {
    seed();
    expect(() => updateTransaction(9999, { note: "x" })).toThrow(/not found/i);
  });
});

describe("deleteTransaction", () => {
  it("removes the transaction", () => {
    const tx = one();
    deleteTransaction(tx.id);
    expect(listTransactions({}).rows).toHaveLength(0);
  });

  it("removes its line items too", () => {
    const tx = one();
    deleteTransaction(tx.id);
    expect(db.select().from(schema.lineItems).all()).toHaveLength(0);
  });

  it("rejects an unknown id", () => {
    seed();
    expect(() => deleteTransaction(9999)).toThrow(/not found/i);
  });
});
```

Note the test file's `one()` helper calls `seed()` indirectly through the tests that need it; add `seed()` at the top of `one()` if a test fails with an unknown category.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && bun test test/editing.test.ts`
Expected: FAIL — `updateTransaction` is not exported.

- [ ] **Step 3: Implement**

Append to `apps/server/src/services/transactions.ts`:

```typescript
import { listTransactions, type TransactionRow } from "./queries";

/**
 * Applies a partial edit to a transaction.
 *
 * The dedup hash is recomputed whenever the date, total or merchant changes, so an
 * edit cannot quietly produce a row identical to an existing one — the same guard
 * that protects the write path protects the edit path.
 */
export function updateTransaction(
  id: number,
  patch: {
    date?: string;
    total?: string | number;
    type?: TransactionType;
    merchant?: string | null;
    note?: string | null;
    lineItems?: LineInput[];
  },
): TransactionRow {
  const existing = db.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!existing) throw new Error(`Transaction not found: ${id}`);

  const existingLines = db
    .select()
    .from(lineItems)
    .where(eq(lineItems.transactionId, id))
    .all();

  const occurredOn = patch.date === undefined ? existing.occurredOn : parseDate(patch.date);
  const totalMinor =
    patch.total === undefined ? existing.totalMinor : parseAmountToMinor(patch.total);
  const merchantRaw = patch.merchant === undefined ? existing.merchantRaw : patch.merchant;
  const type = patch.type ?? (existing.type as TransactionType);

  // Changing the total with several lines present has no single right answer: the
  // server cannot know which line absorbs the difference. The caller must send lines.
  if (
    patch.lineItems === undefined &&
    patch.total !== undefined &&
    existingLines.length > 1 &&
    totalMinor !== existing.totalMinor
  ) {
    throw new Error(
      "Changing the total requires line items when the receipt has more than one line.",
    );
  }

  const resolved =
    patch.lineItems !== undefined
      ? resolveLines(patch.lineItems, totalMinor)
      : existingLines.length === 1
        ? [
            {
              amountMinor: totalMinor,
              categoryId: existingLines[0]!.categoryId,
              note: existingLines[0]!.note,
            },
          ]
        : existingLines.map((l) => ({
            amountMinor: l.amountMinor,
            categoryId: l.categoryId,
            note: l.note,
          }));

  assertLinesMatchTotal(resolved, totalMinor);

  const merchantNorm = merchantRaw ? normalizeMerchant(merchantRaw) : "";
  const dedupHash = computeDedupHash({ occurredOn, totalMinor, merchantNorm });

  const clash = db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.dedupHash, dedupHash))
    .get();
  if (clash && clash.id !== id) {
    throw new Error(`A transaction with the same date, amount and merchant already exists (#${clash.id}).`);
  }

  db.transaction((tx) => {
    const merchantId =
      merchantNorm && type !== "transfer"
        ? upsertMerchant(
            merchantNorm,
            occurredOn,
            resolved.length === 1 && resolved[0]!.categoryId !== null
              ? resolved[0]!.categoryId
              : null,
          )
        : null;

    tx.update(transactions)
      .set({
        occurredOn,
        type,
        totalMinor,
        merchantRaw,
        merchantId,
        note: patch.note === undefined ? existing.note : patch.note,
        dedupHash,
      })
      .where(eq(transactions.id, id))
      .run();

    tx.delete(lineItems).where(eq(lineItems.transactionId, id)).run();
    for (const line of resolved) {
      tx.insert(lineItems)
        .values({
          transactionId: id,
          amountMinor: line.amountMinor,
          categoryId: line.categoryId,
          note: line.note,
        })
        .run();
    }
  });

  const row = listTransactions({}).rows.find((r) => r.id === id);
  if (!row) throw new Error(`Transaction not found after update: ${id}`);
  return row;
}

export function deleteTransaction(id: number): { deleted: true } {
  const existing = db.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!existing) throw new Error(`Transaction not found: ${id}`);

  // line_items has ON DELETE CASCADE, but the delete is explicit so the intent is
  // visible at the call site rather than resting on a schema detail.
  db.transaction((tx) => {
    tx.delete(lineItems).where(eq(lineItems.transactionId, id)).run();
    tx.delete(transactions).where(eq(transactions.id, id)).run();
  });

  return { deleted: true };
}
```

Add the imports this needs at the top of the file:

```typescript
import type { TransactionType } from "@paragon/shared";
import { resolveLines, assertLinesMatchTotal, type LineInput } from "./invariants";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/server && bun test test/editing.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Run the whole suite**

Run: `cd apps/server && bun test`
Expected: PASS, 128 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/transactions.ts apps/server/test/editing.test.ts
git commit -m "feat: update and delete transactions"
```

---

### Task 3: Category write services

**Files:**
- Modify: `apps/server/src/services/categories.ts`
- Test: append to `apps/server/test/categories.test.ts`

**Interfaces:**
- Produces:

```typescript
export function updateCategory(
  id: number,
  patch: { name?: string; parentId?: number | null; isFixed?: boolean },
): { id: number; name: string };

export function archiveCategory(id: number): { archived: true };
```

Archiving rather than deleting is the spec's rule: a category with history disappears from pickers but stays in past reports. Reparenting must reject a cycle — the tree has no depth limit, so a category made its own descendant would hang every path walk in the codebase.

- [ ] **Step 1: Write the failing tests**

Append to `apps/server/test/categories.test.ts`:

```typescript
describe("updateCategory", () => {
  it("renames a category", () => {
    const food = createCategory({ name: "Food" });
    updateCategory(food.id, { name: "Groceries & Food" });
    expect(listCategories()[0]!.name).toBe("Groceries & Food");
  });

  it("moves a category to another parent", () => {
    const home = createCategory({ name: "Home" });
    const household = createCategory({ name: "Household", parentId: home.id });
    const repairs = createCategory({ name: "Repairs", parentId: household.id });

    updateCategory(repairs.id, { parentId: home.id });

    const tree = listCategories();
    expect(tree[0]!.children.map((c) => c.name).sort()).toEqual(["Household", "Repairs"]);
  });

  it("promotes a category to the root", () => {
    const home = createCategory({ name: "Home" });
    const repairs = createCategory({ name: "Repairs", parentId: home.id });

    updateCategory(repairs.id, { parentId: null });

    expect(listCategories().map((c) => c.name).sort()).toEqual(["Home", "Repairs"]);
  });

  it("changes the fixed flag", () => {
    const rent = createCategory({ name: "Rent" });
    updateCategory(rent.id, { isFixed: true });
    expect(listCategories()[0]!.isFixed).toBe(true);
  });

  it("refuses to make a category its own parent", () => {
    const food = createCategory({ name: "Food" });
    expect(() => updateCategory(food.id, { parentId: food.id })).toThrow(/cycle|itself/i);
  });

  it("refuses to move a category under its own descendant", () => {
    const home = createCategory({ name: "Home" });
    const household = createCategory({ name: "Household", parentId: home.id });

    // Home under Household would make the tree circular and hang every path walk.
    expect(() => updateCategory(home.id, { parentId: household.id })).toThrow(/cycle|descendant/i);
  });

  it("rejects an unknown id", () => {
    expect(() => updateCategory(9999, { name: "x" })).toThrow(/not found/i);
  });
});

describe("archiveCategory", () => {
  it("hides the category from the tree", () => {
    const food = createCategory({ name: "Food" });
    createCategory({ name: "Groceries", parentId: food.id });

    archiveCategory(food.id);

    // The child is promoted rather than vanishing: listCategories treats a node whose
    // parent is archived as a root.
    expect(listCategories().map((c) => c.name)).toEqual(["Groceries"]);
  });

  it("keeps the row so past reports still resolve it", () => {
    const food = createCategory({ name: "Food" });
    archiveCategory(food.id);

    const row = db
      .select()
      .from(schema.categories)
      .all()
      .find((c) => c.id === food.id);
    expect(row).toBeDefined();
    expect(row!.archivedAt).not.toBeNull();
  });

  it("rejects an unknown id", () => {
    expect(() => archiveCategory(9999)).toThrow(/not found/i);
  });
});
```

Add `updateCategory` and `archiveCategory` to the file's existing import from `../src/services/categories`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && bun test test/categories.test.ts`
Expected: FAIL — `updateCategory` is not exported.

- [ ] **Step 3: Implement**

Append to `apps/server/src/services/categories.ts`:

```typescript
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
  patch: { name?: string; parentId?: number | null; isFixed?: boolean },
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/server && bun test test/categories.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/categories.ts apps/server/test/categories.test.ts
git commit -m "feat: rename, reparent and archive categories"
```

---

### Task 4: Mutation routes

**Files:**
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/test/routes-editing.test.ts`

**Interfaces:**
- Produces: `PATCH /api/transactions/:id`, `DELETE /api/transactions/:id`, `POST /api/categories`, `PATCH /api/categories/:id`, `DELETE /api/categories/:id`.

`DELETE /api/categories/:id` archives rather than deletes; the verb matches the user's intent, the service does the safe thing.

- [ ] **Step 1: Write the failing test**

`apps/server/test/routes-editing.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { app } from "../src/app";
import { createCategory } from "../src/services/categories";
import { addTransactions } from "../src/services/transactions";
import { listTransactions } from "../src/services/queries";

async function api(path: string, init?: RequestInit) {
  return app.handle(new Request(`http://localhost${path}`, init));
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

beforeEach(() => {
  resetTestDb();
});

function seed() {
  const food = createCategory({ name: "Food" });
  createCategory({ name: "Groceries", parentId: food.id });
  const home = createCategory({ name: "Home" });
  createCategory({ name: "Cleaning", parentId: home.id });
}

function one() {
  seed();
  addTransactions([
    {
      date: "2026-08-09",
      total: "100.00",
      merchant: "Shop",
      lineItems: [{ amount: "100.00", category: "Food/Groceries" }],
    },
  ]);
  return listTransactions({}).rows[0]!;
}

describe("PATCH /api/transactions/:id", () => {
  it("updates the note", async () => {
    const tx = one();
    const res = await api(`/api/transactions/${tx.id}`, json("PATCH", { note: "checked" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.note).toBe("checked");
  });

  it("replaces the line items", async () => {
    const tx = one();
    const res = await api(
      `/api/transactions/${tx.id}`,
      json("PATCH", {
        lineItems: [
          { amount: "70.00", category: "Food/Groceries" },
          { amount: "30.00", category: "Home/Cleaning" },
        ],
      }),
    );

    const body = await res.json();
    expect(body.lines).toHaveLength(2);
  });

  it("returns 422 when the lines do not sum to the total", async () => {
    const tx = one();
    const res = await api(
      `/api/transactions/${tx.id}`,
      json("PATCH", { lineItems: [{ amount: "60.00", category: "Food/Groceries" }] }),
    );
    expect(res.status).toBe(422);
  });

  it("returns 404 for an unknown id", async () => {
    seed();
    const res = await api("/api/transactions/9999", json("PATCH", { note: "x" }));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/transactions/:id", () => {
  it("deletes the transaction", async () => {
    const tx = one();
    const res = await api(`/api/transactions/${tx.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(listTransactions({}).rows).toHaveLength(0);
  });

  it("returns 404 for an unknown id", async () => {
    seed();
    const res = await api("/api/transactions/9999", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("category routes", () => {
  it("creates a category", async () => {
    seed();
    const res = await api("/api/categories", json("POST", { name: "Transport" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.name).toBe("Transport");
  });

  it("renames a category", async () => {
    seed();
    const created = await (await api("/api/categories", json("POST", { name: "Temp" }))).json();
    const res = await api(`/api/categories/${created.id}`, json("PATCH", { name: "Renamed" }));

    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe("Renamed");
  });

  it("returns 422 for a move that would create a cycle", async () => {
    seed();
    const parent = await (await api("/api/categories", json("POST", { name: "Parent" }))).json();
    const child = await (
      await api("/api/categories", json("POST", { name: "Child", parentId: parent.id }))
    ).json();

    const res = await api(`/api/categories/${parent.id}`, json("PATCH", { parentId: child.id }));
    expect(res.status).toBe(422);
  });

  it("archives a category", async () => {
    seed();
    const created = await (await api("/api/categories", json("POST", { name: "Gone" }))).json();
    const res = await api(`/api/categories/${created.id}`, { method: "DELETE" });

    expect(res.status).toBe(200);

    const tree = await (await api("/api/categories")).json();
    expect(tree.map((c: { name: string }) => c.name)).not.toContain("Gone");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && bun test test/routes-editing.test.ts`
Expected: FAIL — the routes return 404.

- [ ] **Step 3: Widen the error handler**

`onError` currently maps only "Invalid month". Editing adds two more failure kinds, and each needs its own status. In `apps/server/src/app.ts`, replace the message check inside `onError` with:

```typescript
    const message = error instanceof Error ? error.message : String(error);

    // "not found" is the caller naming a row that is gone; everything else the services
    // throw is the caller sending something invalid. A 500 here would read as "the
    // server is broken" when the request simply cannot be honoured.
    if (/not found/i.test(message)) {
      set.status = 404;
      return;
    }
    if (
      /^Invalid month/i.test(message) ||
      /does not match/i.test(message) ||
      /Unknown category path/i.test(message) ||
      /already exists/i.test(message) ||
      /cycle/i.test(message) ||
      /requires line items/i.test(message)
    ) {
      set.status = 422;
    }
```

- [ ] **Step 4: Add the routes**

In `apps/server/src/app.ts`, add the imports:

```typescript
import { updateTransaction, deleteTransaction } from "./services/transactions";
import { createCategory, updateCategory, archiveCategory } from "./services/categories";
```

And append the routes before the closing `;` of the chain:

```typescript
  .patch(
    "/transactions/:id",
    ({ params, body }) => updateTransaction(Number(params.id), body),
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        date: t.Optional(t.String()),
        total: t.Optional(t.Union([t.String(), t.Number()])),
        type: t.Optional(t.Union([t.Literal("expense"), t.Literal("income"), t.Literal("transfer")])),
        merchant: t.Optional(t.Union([t.String(), t.Null()])),
        note: t.Optional(t.Union([t.String(), t.Null()])),
        lineItems: t.Optional(
          t.Array(
            t.Object({
              amount: t.Union([t.String(), t.Number()]),
              category: t.Optional(t.String()),
              note: t.Optional(t.String()),
            }),
          ),
        ),
      }),
    },
  )

  .delete("/transactions/:id", ({ params }) => deleteTransaction(Number(params.id)), {
    params: t.Object({ id: t.String() }),
  })

  .post("/categories", ({ body }) => createCategory(body), {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      parentId: t.Optional(t.Union([t.Number(), t.Null()])),
      isFixed: t.Optional(t.Boolean()),
    }),
  })

  .patch("/categories/:id", ({ params, body }) => updateCategory(Number(params.id), body), {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      name: t.Optional(t.String({ minLength: 1 })),
      parentId: t.Optional(t.Union([t.Number(), t.Null()])),
      isFixed: t.Optional(t.Boolean()),
    }),
  })

  .delete("/categories/:id", ({ params }) => archiveCategory(Number(params.id)), {
    params: t.Object({ id: t.String() }),
  })
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/server && bun test test/routes-editing.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `cd apps/server && bun test && bunx tsc --noEmit`
Expected: 148 tests pass, tsc exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/app.ts apps/server/test/routes-editing.test.ts
git commit -m "feat: transaction and category mutation routes"
```

---

### Task 5: Mutation hooks and inline editing

**Files:**
- Modify: `apps/web/src/api/queries.ts`, `apps/web/src/components/TransactionList.tsx`
- Create: `apps/web/src/components/TransactionEditor.tsx`, `apps/web/src/components/CategoryPicker.tsx`
- Test: verified in the browser

**Interfaces:**
- Produces: `useUpdateTransaction`, `useDeleteTransaction`, `useCreateCategory`, `useUpdateCategory`, `useArchiveCategory`; a `TransactionList` whose rows expand into an editor.

Editing is inline rather than a modal: the row stays in place, so the change can be seen against its neighbours. A modal would hide the very context that tells you whether the edit is right.

- [ ] **Step 1: Add the mutation hooks**

Append to `apps/web/src/api/queries.ts`:

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";

/**
 * Everything on the dashboard derives from the same rows, so a single edit invalidates
 * all of it. The lists are small and local; a targeted cache update would be more code
 * for no perceptible gain.
 */
function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["summary"] });
    qc.invalidateQueries({ queryKey: ["trend"] });
    qc.invalidateQueries({ queryKey: ["breakdown"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["categories"] });
    qc.invalidateQueries({ queryKey: ["merchants"] });
  };
}

type LinePatch = { amount: string; category?: string; note?: string };

export function useUpdateTransaction() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (input: {
      id: number;
      date?: string;
      total?: string;
      merchant?: string | null;
      note?: string | null;
      lineItems?: LinePatch[];
    }) => {
      const { id, ...patch } = input;
      const { data, error } = await client.api.transactions({ id: String(id) }).patch(patch);
      if (error) throw new Error(errorMessage(error));
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteTransaction() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await client.api.transactions({ id: String(id) }).delete();
      if (error) throw new Error(errorMessage(error));
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useCreateCategory() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (input: { name: string; parentId?: number | null; isFixed?: boolean }) => {
      const { data, error } = await client.api.categories.post(input);
      if (error) throw new Error(errorMessage(error));
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateCategory() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (input: {
      id: number;
      name?: string;
      parentId?: number | null;
      isFixed?: boolean;
    }) => {
      const { id, ...patch } = input;
      const { data, error } = await client.api.categories({ id: String(id) }).patch(patch);
      if (error) throw new Error(errorMessage(error));
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useArchiveCategory() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await client.api.categories({ id: String(id) }).delete();
      if (error) throw new Error(errorMessage(error));
      return data;
    },
    onSuccess: invalidate,
  });
}
```

And a helper at the top of the file, beneath the imports. The server sets a status without a body, so the readable reason is in the status rather than the payload:

```typescript
/** Turns an Eden error into something worth showing a person. */
function errorMessage(error: { status?: number; value?: unknown }): string {
  if (error.status === 404) return "That entry no longer exists.";
  if (error.status === 422) {
    const value = error.value as { error?: string } | undefined;
    return value?.error ?? "The change was rejected: check the amounts and category.";
  }
  return "Could not save. Is the server running?";
}
```

- [ ] **Step 2: Build the category picker**

`apps/web/src/components/CategoryPicker.tsx`:

```typescript
import type { CategoryNode } from "@paragon/shared";
import { useCategories } from "../api/queries";

/** Flattens the tree into slash-separated paths, preserving order. */
function flatten(nodes: CategoryNode[], prefix = ""): { path: string; depth: number }[] {
  return nodes.flatMap((node) => {
    const path = prefix ? `${prefix}/${node.name}` : node.name;
    return [{ path, depth: prefix.split("/").filter(Boolean).length }, ...flatten(node.children, path)];
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
```

- [ ] **Step 3: Build the editor**

`apps/web/src/components/TransactionEditor.tsx`:

```typescript
import { useState } from "react";
import { useUpdateTransaction, useDeleteTransaction } from "../api/queries";
import { formatMinor } from "@paragon/shared";
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
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="tnum mt-1 w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100"
          />
        </label>
        <label className="text-xs text-ink-300 sm:col-span-2">
          Merchant
          <input
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            className="mt-1 w-full rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100"
          />
        </label>
      </div>

      <p className="mt-4 text-xs uppercase tracking-widest text-ink-300">Lines</p>
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
              onChange={(e) =>
                setLines(lines.map((l, i) => (i === index ? { ...l, amount: e.target.value } : l)))
              }
              className="tnum rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-right text-sm text-ink-100"
            />
            <button
              type="button"
              onClick={() => setLines(lines.filter((_, i) => i !== index))}
              aria-label={`Remove line ${index + 1}`}
              disabled={lines.length === 1}
              className="rounded px-2 py-1 text-ink-300 hover:bg-ink-700 disabled:opacity-30"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={() => setLines([...lines, { amount: "0.00", category: null, note: "" }])}
          className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-300 hover:bg-ink-700"
        >
          Add line
        </button>
        <span className={`tnum text-xs ${balanced ? "text-gain" : "text-flag"}`}>
          {balanced
            ? `Balances at ${formatMinor(row.totalMinor)}`
            : `Lines total ${formatMinor(totalMinor)}, receipt says ${formatMinor(row.totalMinor)}`}
        </span>
      </div>

      <label className="mt-4 block text-xs text-ink-300">
        Note
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
          {update.isPending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-ink-700 px-3 py-1.5 text-sm text-ink-300 hover:bg-ink-700"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => remove.mutate(row.id, { onSuccess: onClose })}
          disabled={remove.isPending}
          className="ml-auto rounded px-3 py-1.5 text-sm text-drain hover:bg-drain/10 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
```

Note the balance indicator is advisory: the server is what enforces the invariant, and this only saves a round trip by naming the difference before Save is pressed.

- [ ] **Step 4: Make rows expandable**

Rewrite `apps/web/src/components/TransactionList.tsx`:

```typescript
import { useState } from "react";
import { dayLabel, money } from "../lib/format";

type Row = {
  id: number;
  occurredOn: number;
  type: string;
  totalMinor: number;
  merchantRaw: string | null;
  note: string | null;
  lines: { id: number; amountMinor: number; categoryPath: string | null; note: string | null }[];
};

/** "groceries +2" — the first category plus how many others share the receipt. */
function categoryLabel(lines: Row["lines"]): string {
  const first = lines[0]?.categoryPath;
  const leaf = first ? (first.split("/").at(-1) ?? first) : "uncategorized";
  return lines.length > 1 ? `${leaf} +${lines.length - 1}` : leaf;
}

export function TransactionList({
  rows,
  renderEditor,
}: {
  rows: Row[];
  renderEditor: (row: Row, close: () => void) => React.ReactNode;
}) {
  const [openId, setOpenId] = useState<number | null>(null);

  if (rows.length === 0) {
    return (
      <section className="border-t border-ink-700 pt-6">
        <h2 className="text-xs uppercase tracking-widest text-ink-300">Purchases</h2>
        <p className="mt-4 text-sm text-ink-300">
          Nothing recorded this month. Send a receipt photo to Claude to add one.
        </p>
      </section>
    );
  }

  return (
    <section className="border-t border-ink-700 pt-6">
      <h2 className="text-xs uppercase tracking-widest text-ink-300">Purchases</h2>

      <ul className="mt-4">
        {rows.map((row) => (
          <li key={row.id} className="border-b border-ink-700 last:border-0">
            <button
              type="button"
              onClick={() => setOpenId(openId === row.id ? null : row.id)}
              aria-expanded={openId === row.id}
              className="grid w-full grid-cols-[3.5rem_1fr_auto] items-center gap-3 py-2.5 text-left text-sm hover:bg-ink-800/50 sm:grid-cols-[3.5rem_1fr_8rem_auto]"
            >
              <span className="tnum text-ink-300">{dayLabel(row.occurredOn)}</span>
              <span className="truncate">{row.merchantRaw ?? "—"}</span>
              <span className="hidden sm:block">
                <span className="rounded bg-ink-800 px-2 py-0.5 text-xs text-ink-300">
                  {row.type === "transfer" ? "transfer" : categoryLabel(row.lines)}
                </span>
              </span>
              <span
                className={`tnum whitespace-nowrap text-right ${
                  row.type === "income"
                    ? "text-gain"
                    : row.type === "transfer"
                      ? "text-ink-300"
                      : ""
                }`}
              >
                {row.type === "expense" ? "−" : row.type === "income" ? "+" : ""}
                {money(row.totalMinor)}
              </span>
            </button>

            {openId === row.id && renderEditor(row, () => setOpenId(null))}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 5: Wire it into the page**

In `apps/web/src/App.tsx`, import the editor and pass it down:

```typescript
import { TransactionEditor } from "./components/TransactionEditor";
```

Replace the `TransactionList` usage with:

```typescript
          {transactions.data && (
            <TransactionList
              rows={transactions.data.rows}
              renderEditor={(row, close) => <TransactionEditor row={row} onClose={close} />}
            />
          )}
```

- [ ] **Step 6: Verify in the browser**

Start both dev servers, then check:

- clicking a row expands it in place; clicking again collapses it
- changing the merchant and pressing Save updates the row and the dashboard figures above
- editing one line of a two-line receipt so the amounts no longer add up shows the imbalance, and Save is rejected with a readable message rather than a stack trace
- Delete removes the row and the totals update
- Cancel discards the changes
- tabbing reaches the row buttons and every field inside an open editor

- [ ] **Step 7: Typecheck and build**

Run: `cd apps/web && bun run build`
Expected: tsc passes, Vite builds.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat: inline transaction editing"
```

---

### Task 6: Category management screen

**Files:**
- Create: `apps/web/src/components/CategoryTree.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: verified in the browser

**Interfaces:**
- Consumes: `useCategories`, `useCreateCategory`, `useUpdateCategory`, `useArchiveCategory`.
- Produces: a second view, reached by a tab beside the month picker.

Reparenting is a select, not drag-and-drop: the plan's phase-3 note stands — dragging is the chat's job, and a select is keyboard-reachable for free.

- [ ] **Step 1: Build the tree view**

`apps/web/src/components/CategoryTree.tsx`:

```typescript
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
      <h2 className="text-xs uppercase tracking-widest text-ink-300">Categories</h2>

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
                      fixed
                    </span>
                  )}
                </>
              )}
            </span>

            <select
              value={node.isFixed ? "fixed" : "flexible"}
              onChange={(e) => update.mutate({ id: node.id, isFixed: e.target.value === "fixed" })}
              aria-label={`Classification for ${node.name}`}
              className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-300"
            >
              <option value="flexible">flexible</option>
              <option value="fixed">fixed</option>
            </select>

            <button
              type="button"
              onClick={() => {
                setEditingId(node.id);
                setEditingName(node.name);
              }}
              className="rounded px-2 py-1 text-xs text-ink-300 hover:bg-ink-800"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => archive.mutate(node.id)}
              className="rounded px-2 py-1 text-xs text-ink-300 hover:bg-drain/10 hover:text-drain"
            >
              Archive
            </button>
          </li>
        ))}
      </ul>

      {error && <p className="mt-3 text-sm text-drain">{error.message}</p>}

      <div className="mt-6 flex flex-wrap items-end gap-2 border-t border-ink-700 pt-4">
        <label className="text-xs text-ink-300">
          New category
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name"
            className="mt-1 block rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100"
          />
        </label>
        <label className="text-xs text-ink-300">
          Under
          <select
            value={newParent ?? ""}
            onChange={(e) => setNewParent(e.target.value ? Number(e.target.value) : null)}
            className="mt-1 block rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100"
          >
            <option value="">Top level</option>
            {rows.map(({ node, depth }) => (
              <option key={node.id} value={node.id}>
                {" ".repeat(depth * 2)}
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
          Add
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Add a view switch**

In `apps/web/src/App.tsx`, add the state and the tabs. Replace the header block with:

```typescript
      <header className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-5">
          <h1 className="text-sm uppercase tracking-widest text-ink-300">Paragon</h1>
          <nav className="flex gap-3 text-sm">
            <button
              type="button"
              onClick={() => setView("dashboard")}
              className={view === "dashboard" ? "text-ink-100" : "text-ink-300 hover:text-ink-100"}
            >
              Dashboard
            </button>
            <button
              type="button"
              onClick={() => setView("categories")}
              className={view === "categories" ? "text-ink-100" : "text-ink-300 hover:text-ink-100"}
            >
              Categories
            </button>
          </nav>
        </div>
        {view === "dashboard" && <MonthPicker month={month} onChange={setMonth} />}
      </header>
```

Add the state alongside `month`:

```typescript
  const [view, setView] = useState<"dashboard" | "categories">("dashboard");
```

And wrap the dashboard sections so the category view replaces them:

```typescript
      {view === "categories" && (
        <div className="mt-10">
          <CategoryTree />
        </div>
      )}

      {view === "dashboard" && !failed && (
        <div className="mt-10 space-y-8">
          {/* existing sections unchanged */}
        </div>
      )}
```

Import `CategoryTree` at the top.

- [ ] **Step 3: Verify in the browser**

- the Categories tab lists the whole tree, indented by depth
- Rename edits in place; Enter saves, Escape cancels
- switching a category between flexible and fixed persists after a reload
- Archive removes it from the list, and the dashboard's category picker no longer offers it
- adding a category under a parent puts it in the right place
- the month picker is hidden on the Categories tab, where it means nothing

- [ ] **Step 4: Typecheck and build**

Run: `cd apps/web && bun run build`
Expected: tsc passes, Vite builds.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat: category management screen"
```

---

## Definition of Done

- `bun test` passes: 148 tests.
- `bunx tsc --noEmit` exits 0 in both apps; `apps/web` builds.
- A transaction can be edited and deleted from the page, and the dashboard figures follow.
- An edit whose lines do not sum to the total is rejected with a readable message, and the stored row is unchanged.
- An edit that would duplicate an existing transaction is rejected.
- Categories can be created, renamed, reclassified and archived; a move that would create a cycle is refused.
- The MCP server still works: `cd apps/server && bun run mcp:e2e`.
- No HTTP route or MCP tool imports `db`.

## Deliberately not in this phase

- **Bulk operations.** Selecting thirty rows and recategorising them at once is `reassign_line_items`, phase 5 — and through the chat it is a sentence rather than thirty clicks.
- **Drag-and-drop reparenting.** A select does the same job, reaches the keyboard for free, and does not need a pointer.
- **Undo.** Every destructive action here is one row; restoring it is one more edit. A history stack would be more machinery than the risk warrants.
- **Drilling into subcategories from the donut.** The breakdown still rolls up to top level. It needs a chart interaction and a filtered list, and is worth doing only once real data shows the top level is too coarse.
