# Paragon Phase 5 — Recategorising History

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Split Home into Household and Repairs, and move the Leroy Merlin purchases across" — one sentence in a chat, one `UPDATE` on the server, eight months of statistics recalculated.

**Architecture:** A single filtered service, `reassignLineItems`, covers merging, splitting and bulk recategorisation. It is exposed as an MCP tool and an HTTP route. Nothing else is added: merge and split are this operation with different filters, and giving them their own tools would triple the surface for no new capability.

**Tech Stack:** Unchanged — Bun, Elysia, Drizzle, `bun:test`.

## Why this phase is the point of the project

The spec names rigid categories as the first of three reasons for not using an off-the-shelf tracker: taxonomy that cannot be reorganised without orphaning history. Everything built so far — the unlimited-depth tree, category archiving rather than deletion, paths instead of ids — exists so this operation is possible. Without it Paragon is a nicer-looking Spendee.

## Global Constraints

Everything from phases 1–4 still holds:

- **MCP tools and HTTP routes never import `db` or Drizzle.** Both call `src/services/`.
- **Tests run against a separate database file** via `test/helpers/db.ts`.
- **Money is an integer in minor units.** Dates are Unix seconds; months go through `src/services/month.ts`.
- **Category depth is unlimited.** Nothing may assume a fixed number of levels.
- **`onError` sets a status without a body** — returning one widens every route's response type.
- **`app.handle()` needs a real hostname.** `http://x/...` returns 404 regardless of the route; use `http://localhost/...`.

New to this phase:

- **Reassigning never changes an amount.** Only `line_items.category_id` moves. The line-sum invariant is therefore untouched by construction, and any code path here that writes `amount_minor` is a defect.
- **A reassignment is one transaction.** Four hundred rows move together or not at all.
- **Every reassignment reports what it did.** A silent "done" after moving 312 rows is indistinguishable from a filter that matched nothing.

## File Structure

```
apps/server/src/services/
  reassign.ts                  NEW — the filtered move
apps/server/src/mcp/tools/
  reassign-line-items.ts       NEW — { def, handler }
apps/server/src/mcp/index.ts   MODIFY — register it
apps/server/src/app.ts         MODIFY — POST /api/reassign
apps/server/test/
  reassign.test.ts             NEW
```

No frontend work. Bulk recategorisation through a UI means selecting rows with checkboxes, which phase 3 deliberately dropped: through the chat it is a sentence, and the sentence is why the tool exists.

---

### Task 1: The reassign service

**Files:**
- Create: `apps/server/src/services/reassign.ts`
- Test: `apps/server/test/reassign.test.ts`

**Interfaces:**
- Consumes: `db`, `lineItems`, `transactions`, `merchants`, `categories` from the schema; `findCategoryByPath` from `./categories`; `normalizeMerchant` from `./dedup`; `monthBounds` from `./month`.
- Produces:

```typescript
export type ReassignFilter = {
  fromCategory?: string;     // category path; includes its whole subtree
  merchant?: string;         // matched on the normalized name
  month?: string;            // "YYYY-MM"
  transactionIds?: number[];
  lineIds?: number[];
  uncategorizedOnly?: boolean;
};

export type ReassignResult = {
  moved: number;
  toCategory: string;
  sampleMerchants: string[];  // up to five distinct merchants that were affected
};

export function previewReassign(filter: ReassignFilter): {
  count: number;
  sampleMerchants: string[];
  totalMinor: number;
};

export function reassignLineItems(filter: ReassignFilter, toCategoryPath: string): ReassignResult;
```

Three decisions worth stating, because each has a wrong-looking alternative:

**`fromCategory` includes the subtree.** Moving "Home" means moving everything filed under Home, at any depth. Matching only lines pinned to the "Home" node itself would silently leave the children behind, and the user asking to reorganise Home does not think of it as a single node.

**An empty filter is rejected.** `reassignLineItems({}, "Food")` would move every line in the database. That is never what someone means, and it is unrecoverable without a backup.

**`previewReassign` exists so the tool can ask before acting.** Claude shows "312 lines, mostly Leroy Merlin and Castorama — proceed?" instead of moving them and reporting afterwards.

- [ ] **Step 1: Write the failing test**

`apps/server/test/reassign.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "bun:test";
import { resetTestDb, db, schema } from "./helpers/db";
import { createCategory, findCategoryByPath } from "../src/services/categories";
import { addTransactions } from "../src/services/transactions";
import { previewReassign, reassignLineItems } from "../src/services/reassign";
import { getCategoryBreakdown } from "../src/services/summary";

beforeEach(() => {
  resetTestDb();
});

function seed() {
  const home = createCategory({ name: "Home" });
  createCategory({ name: "Household", parentId: home.id });
  createCategory({ name: "Repairs", parentId: home.id });
  const food = createCategory({ name: "Food" });
  createCategory({ name: "Groceries", parentId: food.id });
  createCategory({ name: "Renovation" });
}

function expense(date: string, total: string, category: string, merchant: string) {
  addTransactions([{ date, total, merchant, lineItems: [{ amount: total, category }] }]);
}

describe("previewReassign", () => {
  it("counts the lines a filter would move", () => {
    seed();
    expense("2026-08-01", "100.00", "Home/Household", "Leroy Merlin");
    expense("2026-08-02", "200.00", "Home/Household", "Castorama");
    expense("2026-08-03", "300.00", "Food/Groceries", "Biedronka");

    const preview = previewReassign({ fromCategory: "Home/Household" });
    expect(preview.count).toBe(2);
    expect(preview.totalMinor).toBe(30000);
  });

  it("names the merchants involved so the user can recognise them", () => {
    seed();
    expense("2026-08-01", "100.00", "Home/Household", "Leroy Merlin");
    expense("2026-08-02", "200.00", "Home/Household", "Castorama");

    const preview = previewReassign({ fromCategory: "Home/Household" });
    expect(preview.sampleMerchants.sort()).toEqual(["castorama", "leroy merlin"]);
  });

  it("returns zero for a filter that matches nothing", () => {
    seed();
    expect(previewReassign({ merchant: "Nonexistent" }).count).toBe(0);
  });
});

describe("reassignLineItems", () => {
  it("moves lines from one category to another", () => {
    seed();
    expense("2026-08-01", "100.00", "Home/Household", "Leroy Merlin");

    const result = reassignLineItems({ fromCategory: "Home/Household" }, "Home/Repairs");

    expect(result.moved).toBe(1);
    expect(result.toCategory).toBe("Home/Repairs");

    const repairs = findCategoryByPath("Home/Repairs")!;
    const lines = db.select().from(schema.lineItems).all();
    expect(lines[0]!.categoryId).toBe(repairs);
  });

  it("includes the whole subtree of the source category", () => {
    seed();
    // Filed on the parent and on a child; both must move.
    expense("2026-08-01", "100.00", "Home", "Rent");
    expense("2026-08-02", "200.00", "Home/Household", "Leroy Merlin");
    expense("2026-08-03", "300.00", "Home/Repairs", "Castorama");

    const result = reassignLineItems({ fromCategory: "Home" }, "Renovation");
    expect(result.moved).toBe(3);
  });

  it("moves every line of a merchant regardless of month", () => {
    seed();
    expense("2026-06-01", "100.00", "Home/Household", "Rossmann");
    expense("2026-07-01", "200.00", "Home/Household", "Rossmann");
    expense("2026-08-01", "300.00", "Food/Groceries", "Rossmann");

    const result = reassignLineItems({ merchant: "Rossmann" }, "Home/Repairs");
    expect(result.moved).toBe(3);
  });

  it("matches a merchant through its normalized name", () => {
    seed();
    expense("2026-08-01", "100.00", "Food/Groceries", "Żabka");

    // The caller types the bank's spelling; it must still match.
    const result = reassignLineItems({ merchant: "ZABKA" }, "Home/Household");
    expect(result.moved).toBe(1);
  });

  it("restricts to a month when asked", () => {
    seed();
    expense("2026-07-01", "100.00", "Home/Household", "Leroy Merlin");
    expense("2026-08-01", "200.00", "Home/Household", "Leroy Merlin");

    const result = reassignLineItems(
      { fromCategory: "Home/Household", month: "2026-08" },
      "Home/Repairs",
    );
    expect(result.moved).toBe(1);
  });

  it("combines filters as an intersection", () => {
    seed();
    expense("2026-08-01", "100.00", "Home/Household", "Leroy Merlin");
    expense("2026-08-02", "200.00", "Home/Household", "Castorama");

    const result = reassignLineItems(
      { fromCategory: "Home/Household", merchant: "Leroy Merlin" },
      "Home/Repairs",
    );
    expect(result.moved).toBe(1);
  });

  it("moves specific transactions by id", () => {
    seed();
    expense("2026-08-01", "100.00", "Home/Household", "A");
    expense("2026-08-02", "200.00", "Home/Household", "B");

    const ids = db
      .select()
      .from(schema.transactions)
      .all()
      .map((t) => t.id);

    const result = reassignLineItems({ transactionIds: [ids[0]!] }, "Home/Repairs");
    expect(result.moved).toBe(1);
  });

  it("moves only uncategorized lines when asked", () => {
    seed();
    addTransactions([{ date: "2026-08-01", total: "50.00", merchant: "Unknown" }]);
    expense("2026-08-02", "100.00", "Food/Groceries", "Biedronka");

    const result = reassignLineItems({ uncategorizedOnly: true }, "Home/Household");
    expect(result.moved).toBe(1);
  });

  it("never changes an amount", () => {
    seed();
    expense("2026-08-01", "184.20", "Home/Household", "Biedronka");

    reassignLineItems({ fromCategory: "Home/Household" }, "Home/Repairs");

    const line = db.select().from(schema.lineItems).all()[0]!;
    const tx = db.select().from(schema.transactions).all()[0]!;
    expect(line.amountMinor).toBe(18420);
    expect(tx.totalMinor).toBe(18420);
  });

  it("keeps the line-sum invariant intact on a split receipt", () => {
    seed();
    addTransactions([
      {
        date: "2026-08-01",
        total: "300.00",
        merchant: "Biedronka",
        lineItems: [
          { amount: "100.00", category: "Food/Groceries" },
          { amount: "200.00", category: "Home/Household" },
        ],
      },
    ]);

    reassignLineItems({ fromCategory: "Home/Household" }, "Home/Repairs");

    const tx = db.select().from(schema.transactions).all()[0]!;
    const lines = db.select().from(schema.lineItems).all();
    expect(lines.reduce((sum, l) => sum + l.amountMinor, 0)).toBe(tx.totalMinor);
  });

  it("recalculates past statistics", () => {
    seed();
    expense("2026-08-01", "100.00", "Home/Household", "Leroy Merlin");
    expense("2026-08-02", "300.00", "Food/Groceries", "Biedronka");

    const before = getCategoryBreakdown("2026-08");
    expect(before.find((s) => s.name === "Home")!.totalMinor).toBe(10000);

    // This is the feature: history follows the taxonomy.
    reassignLineItems({ fromCategory: "Home/Household" }, "Renovation");

    const after = getCategoryBreakdown("2026-08");
    expect(after.find((s) => s.name === "Home")).toBeUndefined();
    expect(after.find((s) => s.name === "Renovation")!.totalMinor).toBe(10000);
  });

  it("rejects an empty filter", () => {
    seed();
    expense("2026-08-01", "100.00", "Food/Groceries", "Biedronka");

    // Moving everything is never what anyone means, and there is no undo.
    expect(() => reassignLineItems({}, "Home/Repairs")).toThrow(/filter/i);
  });

  it("rejects an unknown destination category", () => {
    seed();
    expense("2026-08-01", "100.00", "Home/Household", "Leroy Merlin");
    expect(() =>
      reassignLineItems({ fromCategory: "Home/Household" }, "Nope/Missing"),
    ).toThrow(/category/i);
  });

  it("rejects an unknown source category", () => {
    seed();
    expect(() =>
      reassignLineItems({ fromCategory: "Nope/Missing" }, "Home/Repairs"),
    ).toThrow(/category/i);
  });

  it("reports zero when the filter matches nothing", () => {
    seed();
    expense("2026-08-01", "100.00", "Food/Groceries", "Biedronka");

    const result = reassignLineItems({ merchant: "Nonexistent" }, "Home/Repairs");
    expect(result.moved).toBe(0);
  });

  it("supports merging: move A into B, then archive A", () => {
    seed();
    expense("2026-08-01", "100.00", "Home/Household", "A");
    expense("2026-08-02", "200.00", "Home/Repairs", "B");

    // Merge Household into Repairs — the spec's stated way to merge categories.
    const result = reassignLineItems({ fromCategory: "Home/Household" }, "Home/Repairs");
    expect(result.moved).toBe(1);

    const repairs = findCategoryByPath("Home/Repairs")!;
    const lines = db.select().from(schema.lineItems).all();
    expect(lines.every((l) => l.categoryId === repairs)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && bun test test/reassign.test.ts`
Expected: FAIL — cannot resolve `../src/services/reassign`.

- [ ] **Step 3: Implement**

`apps/server/src/services/reassign.ts`:

```typescript
import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { lineItems, transactions, merchants, categories } from "../db/schema";
import { findCategoryByPath } from "./categories";
import { normalizeMerchant } from "./dedup";
import { monthBounds } from "./month";

export type ReassignFilter = {
  fromCategory?: string;
  merchant?: string;
  month?: string;
  transactionIds?: number[];
  lineIds?: number[];
  uncategorizedOnly?: boolean;
};

export type ReassignResult = {
  moved: number;
  toCategory: string;
  sampleMerchants: string[];
};

/** Every category at or beneath `rootId`. Depth is unlimited, so this walks down. */
function subtreeIds(rootId: number): number[] {
  const rows = db
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories)
    .all();

  const childrenOf = new Map<number, number[]>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    const list = childrenOf.get(row.parentId) ?? [];
    list.push(row.id);
    childrenOf.set(row.parentId, list);
  }

  const collected: number[] = [];
  const queue = [rootId];
  const seen = new Set<number>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    collected.push(id);
    queue.push(...(childrenOf.get(id) ?? []));
  }
  return collected;
}

/**
 * Builds the WHERE clause for a filter, or null when the filter is empty.
 *
 * Empty is rejected rather than treated as "everything": moving every line in the
 * database is never the intent, and there is no undo.
 */
function buildConditions(filter: ReassignFilter) {
  const conditions = [];

  if (filter.fromCategory !== undefined) {
    const rootId = findCategoryByPath(filter.fromCategory);
    if (rootId === null) throw new Error(`Unknown category path: ${filter.fromCategory}`);
    // The whole subtree moves: reorganising "Home" means its children too.
    conditions.push(inArray(lineItems.categoryId, subtreeIds(rootId)));
  }

  if (filter.uncategorizedOnly) {
    conditions.push(isNull(lineItems.categoryId));
  }

  if (filter.lineIds?.length) {
    conditions.push(inArray(lineItems.id, filter.lineIds));
  }

  if (filter.transactionIds?.length) {
    conditions.push(inArray(lineItems.transactionId, filter.transactionIds));
  }

  if (filter.merchant !== undefined) {
    const nameNorm = normalizeMerchant(filter.merchant);
    const merchant = db.select().from(merchants).where(eq(merchants.nameNorm, nameNorm)).get();
    // An unknown merchant matches nothing rather than everything.
    const merchantId = merchant?.id ?? -1;
    conditions.push(
      inArray(
        lineItems.transactionId,
        db
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.merchantId, merchantId)),
      ),
    );
  }

  if (filter.month !== undefined) {
    const { start, end } = monthBounds(filter.month);
    conditions.push(
      inArray(
        lineItems.transactionId,
        db
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(gte(transactions.occurredOn, start), lt(transactions.occurredOn, end))),
      ),
    );
  }

  return conditions.length ? and(...conditions) : null;
}

/** Distinct normalized merchant names among the matched lines, at most five. */
function sampleMerchantsFor(where: ReturnType<typeof buildConditions>): string[] {
  if (!where) return [];
  const rows = db
    .selectDistinct({ nameNorm: merchants.nameNorm })
    .from(lineItems)
    .innerJoin(transactions, eq(lineItems.transactionId, transactions.id))
    .innerJoin(merchants, eq(transactions.merchantId, merchants.id))
    .where(where)
    .limit(5)
    .all();
  return rows.map((r) => r.nameNorm);
}

/** What a reassignment would do, without doing it. */
export function previewReassign(filter: ReassignFilter): {
  count: number;
  sampleMerchants: string[];
  totalMinor: number;
} {
  const where = buildConditions(filter);
  if (!where) throw new Error("A reassignment needs at least one filter.");

  const row = db
    .select({
      count: sql<number>`count(*)`,
      total: sql<number | null>`sum(${lineItems.amountMinor})`,
    })
    .from(lineItems)
    .where(where)
    .get();

  return {
    count: row?.count ?? 0,
    totalMinor: row?.total ?? 0,
    sampleMerchants: sampleMerchantsFor(where),
  };
}

/**
 * Moves matched line items to another category.
 *
 * This is the project's headline operation: it is what lets the taxonomy be
 * reorganised without orphaning history. Only `category_id` changes — amounts are
 * never touched, so the line-sum invariant holds by construction.
 */
export function reassignLineItems(
  filter: ReassignFilter,
  toCategoryPath: string,
): ReassignResult {
  const toCategoryId = findCategoryByPath(toCategoryPath);
  if (toCategoryId === null) throw new Error(`Unknown category path: ${toCategoryPath}`);

  const where = buildConditions(filter);
  if (!where) throw new Error("A reassignment needs at least one filter.");

  const sampleMerchants = sampleMerchantsFor(where);

  const matched = db
    .select({ id: lineItems.id })
    .from(lineItems)
    .where(where)
    .all()
    .map((r) => r.id);

  if (matched.length === 0) {
    return { moved: 0, toCategory: toCategoryPath, sampleMerchants: [] };
  }

  // One statement: four hundred lines move together or not at all.
  db.update(lineItems)
    .set({ categoryId: toCategoryId })
    .where(inArray(lineItems.id, matched))
    .run();

  return { moved: matched.length, toCategory: toCategoryPath, sampleMerchants };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/server && bun test test/reassign.test.ts`
Expected: PASS, 19 tests.

If "includes the whole subtree" fails with 1 instead of 3, `subtreeIds` is returning only the root — check that `childrenOf` is keyed by parent rather than by child.

- [ ] **Step 5: Run the whole suite**

Run: `cd apps/server && bun test`
Expected: PASS, 167 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/reassign.ts apps/server/test/reassign.test.ts
git commit -m "feat: reassign line items across categories"
```

---

### Task 2: The MCP tool

**Files:**
- Create: `apps/server/src/mcp/tools/reassign-line-items.ts`
- Modify: `apps/server/src/mcp/index.ts`
- Test: covered by the end-to-end script in Task 4

**Interfaces:**
- Consumes: `previewReassign`, `reassignLineItems` from `../../services/reassign`; `formatMinor` from `../../money`.
- Produces: the `reassign_line_items` tool.

The description carries more weight than the code. It has to convey three things: that this is how categories get reorganised, that `preview` should come first for anything large, and that the operation cannot be undone.

- [ ] **Step 1: Write the tool**

`apps/server/src/mcp/tools/reassign-line-items.ts`:

```typescript
import { z } from "zod";
import { previewReassign, reassignLineItems } from "../../services/reassign";
import { formatMinor } from "../../money";

const filterSchema = {
  fromCategory: z
    .string()
    .optional()
    .describe('Category path to move out of, including everything beneath it, e.g. "Home"'),
  merchant: z.string().optional().describe("Merchant name; matched however it was spelled"),
  month: z.string().optional().describe('Restrict to one month, "YYYY-MM"'),
  transactionIds: z.array(z.number()).optional().describe("Specific transactions to move"),
  uncategorizedOnly: z
    .boolean()
    .optional()
    .describe("Only lines that have no category yet"),
};

export const def = {
  name: "reassign_line_items",
  config: {
    title: "Move spending to another category",
    description:
      "Moves matched line items into a different category, rewriting past months as well as " +
      "the current one. This is how the taxonomy gets reorganised: splitting a category, " +
      "merging two, or correcting where a shop has always been filed. " +
      "Merging is this tool plus set_merchant_category or update_category — there is no " +
      "separate merge tool. " +
      "Set preview: true first when the filter could match many lines; it reports the count " +
      "and the merchants involved without changing anything. There is no undo, so a filter " +
      "that matches more than expected should be narrowed rather than run. " +
      "At least one filter is required. Amounts are never changed, only categories.",
    inputSchema: {
      ...filterSchema,
      toCategory: z.string().describe('Destination category path, e.g. "Home/Repairs"'),
      preview: z
        .boolean()
        .optional()
        .describe("Report what would move without moving it"),
    },
  },
};

export async function handler(input: {
  fromCategory?: string;
  merchant?: string;
  month?: string;
  transactionIds?: number[];
  uncategorizedOnly?: boolean;
  toCategory: string;
  preview?: boolean;
}) {
  const { toCategory, preview, ...filter } = input;

  try {
    if (preview) {
      const result = previewReassign(filter);
      if (result.count === 0) {
        return {
          content: [{ type: "text" as const, text: "Nothing matches that filter." }],
        };
      }
      const who = result.sampleMerchants.length
        ? ` Merchants: ${result.sampleMerchants.join(", ")}.`
        : "";
      return {
        content: [
          {
            type: "text" as const,
            text:
              `${result.count} line${result.count === 1 ? "" : "s"} totalling ` +
              `${formatMinor(result.totalMinor)} would move to ${toCategory}.${who} ` +
              `Run again without preview to apply.`,
          },
        ],
      };
    }

    const result = reassignLineItems(filter, toCategory);

    if (result.moved === 0) {
      return {
        content: [{ type: "text" as const, text: "Nothing matched that filter; nothing changed." }],
      };
    }

    const who = result.sampleMerchants.length
      ? ` Affected merchants: ${result.sampleMerchants.join(", ")}.`
      : "";
    return {
      content: [
        {
          type: "text" as const,
          text: `Moved ${result.moved} line${result.moved === 1 ? "" : "s"} to ${result.toCategory}.${who} Past months are recalculated.`,
        },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Could not reassign: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}
```

- [ ] **Step 2: Register it**

In `apps/server/src/mcp/index.ts`, add the import beneath the others:

```typescript
import {
  def as reassignDef,
  handler as reassignHandler,
} from "./tools/reassign-line-items";
```

And the registration:

```typescript
server.registerTool(reassignDef.name, reassignDef.config, reassignHandler);
```

- [ ] **Step 3: Verify the server lists five tools**

Run from `apps/server`:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | timeout 6 bun run src/mcp/index.ts 2>/dev/null | tail -1 \
  | python3 -c "import sys,json; print(', '.join(t['name'] for t in json.load(sys.stdin)['result']['tools']))"
```

Expected: `list_categories, add_transactions, get_merchant, set_merchant_category, reassign_line_items`.

- [ ] **Step 4: Typecheck**

Run: `cd apps/server && bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/mcp
git commit -m "feat: reassign_line_items MCP tool"
```

---

### Task 3: The HTTP route

**Files:**
- Modify: `apps/server/src/app.ts`
- Test: append to `apps/server/test/routes-editing.test.ts`

**Interfaces:**
- Produces: `POST /api/reassign`.

A POST rather than a PATCH: this is an operation, not a resource update, and it has no single target id.

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test/routes-editing.test.ts`:

```typescript
describe("POST /api/reassign", () => {
  it("moves lines and reports the count", async () => {
    seed();
    addTransactions([
      {
        date: "2026-08-09",
        total: "100.00",
        merchant: "Leroy Merlin",
        lineItems: [{ amount: "100.00", category: "Home/Cleaning" }],
      },
    ]);

    const res = await api(
      "/api/reassign",
      json("POST", { fromCategory: "Home/Cleaning", toCategory: "Food/Groceries" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.moved).toBe(1);
  });

  it("previews without changing anything", async () => {
    seed();
    addTransactions([
      {
        date: "2026-08-09",
        total: "100.00",
        merchant: "Shop",
        lineItems: [{ amount: "100.00", category: "Home/Cleaning" }],
      },
    ]);

    const res = await api(
      "/api/reassign",
      json("POST", {
        fromCategory: "Home/Cleaning",
        toCategory: "Food/Groceries",
        preview: true,
      }),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).count).toBe(1);

    // Still where it was.
    const after = await (await api("/api/breakdown?month=2026-08")).json();
    expect(after[0].name).toBe("Home");
  });

  it("returns 422 for an empty filter", async () => {
    seed();
    const res = await api("/api/reassign", json("POST", { toCategory: "Food/Groceries" }));
    expect(res.status).toBe(422);
  });

  it("returns 422 for an unknown destination", async () => {
    seed();
    const res = await api(
      "/api/reassign",
      json("POST", { fromCategory: "Home/Cleaning", toCategory: "Nope/Missing" }),
    );
    expect(res.status).toBe(422);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && bun test test/routes-editing.test.ts`
Expected: FAIL — the route returns 404.

- [ ] **Step 3: Add the route**

In `apps/server/src/app.ts`, add the import:

```typescript
import { reassignLineItems, previewReassign } from "./services/reassign";
```

Widen the error handler to map the empty-filter message. In the `onError` list of 422 patterns, add:

```typescript
      /needs at least one filter/i.test(message) ||
```

And add the route to the chain:

```typescript
  .post(
    "/reassign",
    ({ body }) => {
      const { toCategory, preview, ...filter } = body;
      return preview ? previewReassign(filter) : reassignLineItems(filter, toCategory);
    },
    {
      body: t.Object({
        toCategory: t.String({ minLength: 1 }),
        preview: t.Optional(t.Boolean()),
        fromCategory: t.Optional(t.String()),
        merchant: t.Optional(t.String()),
        month: t.Optional(t.String({ pattern: monthPattern })),
        transactionIds: t.Optional(t.Array(t.Number())),
        uncategorizedOnly: t.Optional(t.Boolean()),
      }),
    },
  )
```

Note the preview branch ignores `toCategory` — the preview reports what a filter matches, and the destination only appears in the message the caller composes.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/server && bun test test/routes-editing.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `cd apps/server && bun test && bunx tsc --noEmit`
Expected: 171 tests pass, tsc exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/app.ts apps/server/test/routes-editing.test.ts
git commit -m "feat: reassign HTTP route"
```

---

### Task 4: End-to-end proof of the headline feature

**Files:**
- Modify: `apps/server/scripts/mcp-e2e.ts`

**Interfaces:**
- Consumes: the five registered tools over stdio JSON-RPC.

The claim being proved is the one the whole project rests on: reorganise the taxonomy and the past follows. A test asserting a row count does not demonstrate that; a before-and-after breakdown does.

- [ ] **Step 1: Extend the script**

In `apps/server/scripts/mcp-e2e.ts`, insert before the final database summary block:

```typescript
// The headline feature: split a category and watch past months follow.
const { createCategory: mkCategory } = await import(join(SERVER_ROOT, "src/services/categories"));
const { getCategoryBreakdown } = await import(join(SERVER_ROOT, "src/services/summary"));

mkCategory({ name: "Renovation" });

const beforeSplit = getCategoryBreakdown("2026-08");
console.log(
  "14. breakdown before:",
  beforeSplit.map((s: { name: string; totalMinor: number }) => `${s.name} ${s.totalMinor}`).join(", "),
);

const previewMove = await send("tools/call", {
  name: "reassign_line_items",
  arguments: { fromCategory: "Home/Cleaning", toCategory: "Renovation", preview: true },
});
console.log("15. preview ->", text(previewMove).replace(/\n+/g, " | "));

const applyMove = await send("tools/call", {
  name: "reassign_line_items",
  arguments: { fromCategory: "Home/Cleaning", toCategory: "Renovation" },
});
console.log("16. apply ->", text(applyMove).replace(/\n+/g, " | "));

const afterSplit = getCategoryBreakdown("2026-08");
console.log(
  "17. breakdown after:",
  afterSplit.map((s: { name: string; totalMinor: number }) => `${s.name} ${s.totalMinor}`).join(", "),
);

const emptyFilter = await send("tools/call", {
  name: "reassign_line_items",
  arguments: { toCategory: "Renovation" },
});
console.log("18. empty filter refused ->", text(emptyFilter).replace(/\n+/g, " | "));
```

Renumber the existing final block from `14.` to `19.`.

- [ ] **Step 2: Run it**

Run: `cd apps/server && bun run mcp:e2e`

Expected:

- step 14 shows Home holding the split receipt's cleaning line
- step 15 reports one line and its amount without changing anything
- step 16 confirms the move
- step 17 shows the amount now under Renovation and Home reduced — the same month, recalculated
- step 18 refuses the empty filter rather than moving everything

- [ ] **Step 3: Commit**

```bash
git add apps/server/scripts/mcp-e2e.ts
git commit -m "test: end-to-end proof that history follows the taxonomy"
```

---

## Definition of Done

- `bun test` passes: 171 tests.
- `bunx tsc --noEmit` exits 0 in both apps.
- `bun run mcp:e2e` shows a category breakdown changing for a past month as a result of one reassignment.
- An empty filter is refused by the service, the tool and the route.
- Amounts are unchanged by every reassignment; the line-sum invariant holds on split receipts.
- The MCP server registers five tools.
- No HTTP route or MCP tool imports `db`.

## Deliberately not in this phase

- **Undo.** A reassignment can be reversed by running the opposite one, and the tool reports exactly what it moved. A history stack would be real machinery for a case the report already covers.
- **A frontend button for bulk moves.** It would need row selection, which phase 3 dropped on purpose: through the chat this is a sentence.
- **Automatic merge/split tools.** The spec is explicit that this one tool covers both. A `merge_categories` wrapper would add surface without capability.
- **Rewriting merchant defaults as a side effect.** Moving a shop's history does not necessarily mean its next purchase belongs there; `set_merchant_category` is the deliberate act.
