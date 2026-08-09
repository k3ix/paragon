# Paragon Phase 2 — Merchant Memory

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude stops re-deciding what category a shop belongs to. Asking about a merchant returns what was chosen last time — "Żabka has been groceries 47 times" — so categories stop drifting month to month.

**Architecture:** The `merchants` table already exists and already counts sightings, but `default_category_id` is never written, so the memory is empty by construction. This phase fills it on write, exposes it through a `get_merchant` tool, and adds an explicit correction path so a wrong default can be fixed without editing history.

**Tech Stack:** Unchanged from phase 1 — Bun, Drizzle, `bun:sqlite`, `@modelcontextprotocol/sdk` 1.30, Zod 4, `bun:test`.

## Global Constraints

Everything from the phase 1 plan still applies. Restated because they bind every task here:

- **MCP tools never import `db` or Drizzle.** They import from `src/services/`. A tool that queries the database directly is a defect.
- **Tests run against a separate database file** via `test/helpers/db.ts`, never the working one.
- **Money is an integer in minor units.** Dates are integer Unix seconds.
- **Migrations are versioned files** from `drizzle-kit generate`. Never `db:push`.
- **Zod 4 syntax**, `registerTool` rather than the deprecated `server.tool()`.
- Category depth is unlimited; nothing may assume a fixed number of levels.

## What already exists

Read before starting — this phase modifies rather than creates:

- `apps/server/src/db/schema.ts` — `merchants` table with `nameNorm` (unique), `defaultCategoryId` (nullable, currently never written), `seenCount`, `lastSeenAt`.
- `apps/server/src/services/transactions.ts` — `upsertMerchant(nameNorm, occurredOn)` creates the row and increments `seenCount`. It does **not** touch `defaultCategoryId`.
- `apps/server/src/services/dedup.ts` — `normalizeMerchant` collapses spellings to a key.
- `apps/server/src/services/categories.ts` — `findCategoryByPath`, `listCategories`, `CategoryNode`.

## File Structure

```
apps/server/
  src/services/merchants.ts          NEW — read and correct merchant memory
  src/services/transactions.ts       MODIFY — learn the default category on write
  src/mcp/tools/get-merchant.ts      NEW — { def, handler }
  src/mcp/tools/set-merchant-category.ts  NEW — { def, handler }
  src/mcp/index.ts                   MODIFY — register two more tools
  test/merchants.test.ts             NEW
  test/transactions.test.ts          MODIFY — assert the default is learned
```

`merchants.ts` is separate from `transactions.ts` because reading the memory has no write invariants and will later serve the frontend's merchant list. Learning stays inside the transaction write path, since it must happen in the same unit of work as the insert.

---

### Task 1: Learn the default category on write

**Files:**
- Modify: `apps/server/src/services/transactions.ts`
- Test: `apps/server/test/transactions.test.ts`

**Interfaces:**
- Consumes: existing `upsertMerchant`, `lineItems` resolution inside `addOne`.
- Produces: no new exports. After this task `merchants.default_category_id` is populated.

The learning rule: a merchant's default is the category of its **most recent** single-category transaction. Receipts split across several categories teach nothing — a Biedronka basket covering groceries, cleaning and alcohol has no single answer. Most-recent rather than most-frequent so that a deliberate correction takes effect immediately instead of being outvoted by history.

- [ ] **Step 1: Write the failing tests**

Append to `apps/server/test/transactions.test.ts`, inside the existing `describe("addTransactions", ...)` block:

```typescript
  it("learns the default category from a single-category transaction", () => {
    const { groceries } = seedCategories();
    addTransactions([
      {
        date: "2026-08-09",
        total: "23.50",
        merchant: "Żabka",
        lineItems: [{ amount: "23.50", category: "Food/Groceries" }],
      },
    ]);

    const merchant = db.select().from(schema.merchants).all()[0]!;
    expect(merchant.defaultCategoryId).toBe(groceries.id);
  });

  it("learns nothing from a receipt split across categories", () => {
    seedCategories();
    addTransactions([
      {
        date: "2026-08-09",
        total: "184.20",
        merchant: "Biedronka",
        lineItems: [
          { amount: "124.30", category: "Food/Groceries" },
          { amount: "38.00", category: "Home/Cleaning" },
          { amount: "21.90", category: "Food/Groceries" },
        ],
      },
    ]);

    const merchant = db.select().from(schema.merchants).all()[0]!;
    expect(merchant.defaultCategoryId).toBeNull();
  });

  it("keeps an existing default when a later receipt is split", () => {
    const { groceries } = seedCategories();
    addTransactions([
      {
        date: "2026-08-09",
        total: "23.50",
        merchant: "Biedronka",
        lineItems: [{ amount: "23.50", category: "Food/Groceries" }],
      },
    ]);
    addTransactions([
      {
        date: "2026-08-10",
        total: "184.20",
        merchant: "Biedronka",
        lineItems: [
          { amount: "146.20", category: "Food/Groceries" },
          { amount: "38.00", category: "Home/Cleaning" },
        ],
      },
    ]);

    const merchant = db.select().from(schema.merchants).all()[0]!;
    expect(merchant.defaultCategoryId).toBe(groceries.id);
  });

  it("moves the default when the merchant is filed elsewhere later", () => {
    seedCategories();
    const cleaning = findCategoryByPath("Home/Cleaning")!;
    addTransactions([
      {
        date: "2026-08-09",
        total: "23.50",
        merchant: "Rossmann",
        lineItems: [{ amount: "23.50", category: "Food/Groceries" }],
      },
    ]);
    addTransactions([
      {
        date: "2026-08-10",
        total: "31.00",
        merchant: "Rossmann",
        lineItems: [{ amount: "31.00", category: "Home/Cleaning" }],
      },
    ]);

    const merchant = db.select().from(schema.merchants).all()[0]!;
    expect(merchant.defaultCategoryId).toBe(cleaning);
  });

  it("learns nothing from an uncategorized line", () => {
    seedCategories();
    addTransactions([{ date: "2026-08-09", total: "23.50", merchant: "Żabka" }]);

    const merchant = db.select().from(schema.merchants).all()[0]!;
    expect(merchant.defaultCategoryId).toBeNull();
  });
```

Add `findCategoryByPath` to the existing import from `../src/services/categories` at the top of the file, so the fourth test can resolve the id:

```typescript
import { createCategory, findCategoryByPath } from "../src/services/categories";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/server && bun test test/transactions.test.ts`
Expected: FAIL — five new tests fail, each reporting `null` where a category id was expected (or the reverse in the "learns nothing" cases, which may pass incidentally since nothing is written yet).

- [ ] **Step 3: Implement**

In `apps/server/src/services/transactions.ts`, change the `upsertMerchant` signature to accept the category to learn, and write it:

```typescript
/**
 * Finds or creates the merchant row, bumps its sighting counter, and records the
 * category to default to next time.
 *
 * `learnCategoryId` is the category of a single-category transaction, or null when
 * the receipt was split — a mixed basket teaches nothing about where the shop belongs.
 * The most recent single-category filing wins rather than the most frequent, so a
 * deliberate correction takes effect at once instead of being outvoted by history.
 */
function upsertMerchant(
  nameNorm: string,
  occurredOn: number,
  learnCategoryId: number | null,
): number {
  const existing = db.select().from(merchants).where(eq(merchants.nameNorm, nameNorm)).get();

  if (existing) {
    db.update(merchants)
      .set({
        seenCount: existing.seenCount + 1,
        lastSeenAt: Math.max(existing.lastSeenAt ?? 0, occurredOn),
        // Keep the previous default when this receipt teaches nothing.
        defaultCategoryId: learnCategoryId ?? existing.defaultCategoryId,
      })
      .where(eq(merchants.id, existing.id))
      .run();
    return existing.id;
  }

  return db
    .insert(merchants)
    .values({
      nameNorm,
      seenCount: 1,
      lastSeenAt: occurredOn,
      defaultCategoryId: learnCategoryId,
    })
    .returning({ id: merchants.id })
    .get().id;
}
```

Then, inside `addOne`, compute what this transaction teaches and pass it in. Find the existing line:

```typescript
    const merchantId =
      merchantNorm && item.type !== "transfer" ? upsertMerchant(merchantNorm, occurredOn) : null;
```

Replace it with:

```typescript
    // A single line with a category is an unambiguous filing; anything else is not.
    const learnCategoryId =
      resolved.length === 1 && resolved[0]!.categoryId !== null ? resolved[0]!.categoryId : null;

    const merchantId =
      merchantNorm && item.type !== "transfer"
        ? upsertMerchant(merchantNorm, occurredOn, learnCategoryId)
        : null;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/server && bun test test/transactions.test.ts`
Expected: PASS, 21 tests.

- [ ] **Step 5: Run the whole suite**

Run: `cd apps/server && bun test`
Expected: PASS, 66 tests. Nothing from phase 1 regresses.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/transactions.ts apps/server/test/transactions.test.ts
git commit -m "feat: learn merchant default category on write"
```

---

### Task 2: Merchant read service

**Files:**
- Create: `apps/server/src/services/merchants.ts`
- Test: `apps/server/test/merchants.test.ts`

**Interfaces:**
- Consumes: `db`, `merchants`, `categories`, `lineItems`, `transactions` from `src/db/schema`; `normalizeMerchant` from `src/services/dedup`; `findCategoryByPath` from `src/services/categories`.
- Produces: from `src/services/merchants.ts`:
  - `type MerchantMemory = { nameNorm: string; categoryPath: string | null; seenCount: number; lastSeenAt: number | null; averageMinor: number | null }`
  - `getMerchant(rawName: string): MerchantMemory | null`
  - `listMerchants(): MerchantMemory[]` — ordered by `seenCount` descending
  - `setMerchantCategory(rawName: string, categoryPath: string): MerchantMemory`

`categoryPath` is returned rather than a raw id because Claude works in paths, and the frontend needs a label anyway. Building the path walks up the parent chain, since depth is unlimited.

`averageMinor` is the mean transaction total for the merchant. It costs one aggregate on data already present and answers "is this a big shop or a corner store" — the number the phase-2 spec calls average basket.

- [ ] **Step 1: Write the failing test**

`apps/server/test/merchants.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { getMerchant, listMerchants, setMerchantCategory } from "../src/services/merchants";
import { createCategory } from "../src/services/categories";
import { addTransactions } from "../src/services/transactions";

beforeEach(() => {
  resetTestDb();
});

function seedCategories() {
  const food = createCategory({ name: "Food" });
  createCategory({ name: "Groceries", parentId: food.id });
  const home = createCategory({ name: "Home" });
  createCategory({ name: "Cleaning", parentId: home.id });
}

function record(merchant: string, date: string, total: string, category?: string) {
  addTransactions([
    {
      date,
      total,
      merchant,
      lineItems: category ? [{ amount: total, category }] : undefined,
    },
  ]);
}

describe("getMerchant", () => {
  it("returns null for an unknown merchant", () => {
    seedCategories();
    expect(getMerchant("Nonexistent")).toBeNull();
  });

  it("returns the remembered category as a path", () => {
    seedCategories();
    record("Żabka", "2026-08-09", "23.50", "Food/Groceries");

    const memory = getMerchant("Żabka");
    expect(memory?.categoryPath).toBe("Food/Groceries");
  });

  it("matches the bank spelling of the same shop", () => {
    seedCategories();
    record("Żabka", "2026-08-09", "23.50", "Food/Groceries");

    // The statement writes it without diacritics and in capitals.
    expect(getMerchant("ZABKA")?.categoryPath).toBe("Food/Groceries");
  });

  it("reports how many times the merchant was seen", () => {
    seedCategories();
    record("Żabka", "2026-08-09", "23.50", "Food/Groceries");
    record("Żabka", "2026-08-10", "17.90", "Food/Groceries");

    expect(getMerchant("Żabka")?.seenCount).toBe(2);
  });

  it("reports the average transaction total in minor units", () => {
    seedCategories();
    record("Żabka", "2026-08-09", "20.00", "Food/Groceries");
    record("Żabka", "2026-08-10", "10.00", "Food/Groceries");

    expect(getMerchant("Żabka")?.averageMinor).toBe(1500);
  });

  it("reports a null category when nothing was ever learned", () => {
    seedCategories();
    record("Żabka", "2026-08-09", "23.50");

    const memory = getMerchant("Żabka");
    expect(memory).not.toBeNull();
    expect(memory?.categoryPath).toBeNull();
  });

  it("builds a deep path for a nested category", () => {
    const home = createCategory({ name: "Home" });
    const household = createCategory({ name: "Household", parentId: home.id });
    createCategory({ name: "Cleaning", parentId: household.id });
    record("Rossmann", "2026-08-09", "31.00", "Home/Household/Cleaning");

    expect(getMerchant("Rossmann")?.categoryPath).toBe("Home/Household/Cleaning");
  });
});

describe("listMerchants", () => {
  it("returns an empty array when there are none", () => {
    expect(listMerchants()).toEqual([]);
  });

  it("orders by sighting count, most frequent first", () => {
    seedCategories();
    record("Orlen", "2026-08-01", "310.00", "Food/Groceries");
    record("Żabka", "2026-08-09", "23.50", "Food/Groceries");
    record("Żabka", "2026-08-10", "17.90", "Food/Groceries");

    const list = listMerchants();
    expect(list.map((m) => m.nameNorm)).toEqual(["zabka", "orlen"]);
  });
});

describe("setMerchantCategory", () => {
  it("overrides a learned default", () => {
    seedCategories();
    record("Rossmann", "2026-08-09", "31.00", "Food/Groceries");

    const updated = setMerchantCategory("Rossmann", "Home/Cleaning");
    expect(updated.categoryPath).toBe("Home/Cleaning");
    expect(getMerchant("Rossmann")?.categoryPath).toBe("Home/Cleaning");
  });

  it("creates the memory for a merchant with no transactions yet", () => {
    seedCategories();
    const created = setMerchantCategory("Lidl", "Food/Groceries");

    expect(created.nameNorm).toBe("lidl");
    expect(created.categoryPath).toBe("Food/Groceries");
    expect(created.seenCount).toBe(0);
  });

  it("rejects an unknown category path", () => {
    seedCategories();
    expect(() => setMerchantCategory("Lidl", "Nonexistent/Path")).toThrow(/category/i);
  });

  it("does not change past transactions", () => {
    seedCategories();
    record("Rossmann", "2026-08-09", "31.00", "Food/Groceries");
    setMerchantCategory("Rossmann", "Home/Cleaning");

    // Only the default for next time moves; history is phase 5's job.
    const memory = getMerchant("Rossmann");
    expect(memory?.categoryPath).toBe("Home/Cleaning");
    expect(memory?.seenCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && bun test test/merchants.test.ts`
Expected: FAIL — cannot resolve `../src/services/merchants`.

- [ ] **Step 3: Implement**

`apps/server/src/services/merchants.ts`:

```typescript
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { merchants, categories, transactions } from "../db/schema";
import { normalizeMerchant } from "./dedup";
import { findCategoryByPath } from "./categories";

export type MerchantMemory = {
  nameNorm: string;
  categoryPath: string | null;
  seenCount: number;
  lastSeenAt: number | null;
  averageMinor: number | null;
};

/**
 * Walks a category up to its root and renders the full slash-separated path.
 *
 * Depth is unlimited, so this loops rather than joining a fixed number of levels.
 * The visited set guards against a parent cycle, which the schema permits.
 */
function buildCategoryPath(categoryId: number): string | null {
  const segments: string[] = [];
  const visited = new Set<number>();
  let current: number | null = categoryId;

  while (current !== null) {
    if (visited.has(current)) break;
    visited.add(current);

    const row: { name: string; parentId: number | null } | undefined = db
      .select({ name: categories.name, parentId: categories.parentId })
      .from(categories)
      .where(eq(categories.id, current))
      .get();

    if (!row) break;
    segments.unshift(row.name);
    current = row.parentId;
  }

  return segments.length ? segments.join("/") : null;
}

/** Mean transaction total for a merchant, in minor units. Null when it has none. */
function averageTotal(merchantId: number): number | null {
  const row = db
    .select({ avg: sql<number | null>`avg(${transactions.totalMinor})` })
    .from(transactions)
    .where(eq(transactions.merchantId, merchantId))
    .get();

  return row?.avg === null || row?.avg === undefined ? null : Math.round(row.avg);
}

function toMemory(row: typeof merchants.$inferSelect): MerchantMemory {
  return {
    nameNorm: row.nameNorm,
    categoryPath: row.defaultCategoryId === null ? null : buildCategoryPath(row.defaultCategoryId),
    seenCount: row.seenCount,
    lastSeenAt: row.lastSeenAt,
    averageMinor: averageTotal(row.id),
  };
}

/**
 * Looks up what was decided about a shop last time.
 *
 * The lookup normalizes first, so the receipt spelling ("Żabka") and the statement
 * spelling ("ZABKA") reach the same row.
 */
export function getMerchant(rawName: string): MerchantMemory | null {
  const nameNorm = normalizeMerchant(rawName);
  if (!nameNorm) return null;

  const row = db.select().from(merchants).where(eq(merchants.nameNorm, nameNorm)).get();
  return row ? toMemory(row) : null;
}

/** Every known merchant, most frequently seen first. */
export function listMerchants(): MerchantMemory[] {
  return db.select().from(merchants).orderBy(desc(merchants.seenCount)).all().map(toMemory);
}

/**
 * Pins a merchant to a category, overriding whatever was learned.
 *
 * Only the default for future transactions changes. Rewriting past line items is
 * reassign_line_items in phase 5 and is deliberately not bundled here: correcting a
 * default and rewriting history are different intentions.
 */
export function setMerchantCategory(rawName: string, categoryPath: string): MerchantMemory {
  const nameNorm = normalizeMerchant(rawName);
  if (!nameNorm) throw new Error(`Merchant name is empty: ${rawName}`);

  const categoryId = findCategoryByPath(categoryPath);
  if (categoryId === null) throw new Error(`Unknown category path: ${categoryPath}`);

  const existing = db.select().from(merchants).where(eq(merchants.nameNorm, nameNorm)).get();

  if (existing) {
    db.update(merchants)
      .set({ defaultCategoryId: categoryId })
      .where(eq(merchants.id, existing.id))
      .run();
    return toMemory({ ...existing, defaultCategoryId: categoryId });
  }

  const inserted = db
    .insert(merchants)
    .values({ nameNorm, defaultCategoryId: categoryId, seenCount: 0, lastSeenAt: null })
    .returning()
    .get();

  return toMemory(inserted);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/server && bun test test/merchants.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/merchants.ts apps/server/test/merchants.test.ts
git commit -m "feat: merchant memory read service"
```

---

### Task 3: MCP tools for merchant memory

**Files:**
- Create: `apps/server/src/mcp/tools/get-merchant.ts`, `apps/server/src/mcp/tools/set-merchant-category.ts`
- Modify: `apps/server/src/mcp/index.ts`, `apps/server/src/mcp/tools/add-transactions.ts`
- Test: verified through the end-to-end script in Task 4

**Interfaces:**
- Consumes: `getMerchant`, `setMerchantCategory` from `src/services/merchants`; `formatMinor` from `src/money`.
- Produces: two registered tools, `get_merchant` and `set_merchant_category`.

The tool descriptions matter more than the code here — they are the only instruction Claude gets about when to call them. `get_merchant` must read as something to call *before* writing, or it will not be called at all and the whole phase is inert.

- [ ] **Step 1: Write the get_merchant tool**

`apps/server/src/mcp/tools/get-merchant.ts`:

```typescript
import { z } from "zod";
import { getMerchant } from "../../services/merchants";
import { formatMinor } from "../../money";

export const def = {
  name: "get_merchant",
  config: {
    title: "Look up a merchant",
    description:
      "Returns what was decided about a shop previously: its usual category, how many times " +
      "it has been recorded, and the average amount. ALWAYS call this before add_transactions " +
      "for each merchant on the receipt, and reuse the category it returns. This is what keeps " +
      "the same shop in the same category month after month instead of drifting. " +
      "A null category means the shop is new or has only ever appeared on split receipts — " +
      "choose a category from list_categories in that case.",
    inputSchema: {
      name: z.string().describe("Merchant name as printed on the receipt or statement"),
    },
  },
};

export async function handler(input: { name: string }) {
  const memory = getMerchant(input.name);

  if (!memory) {
    return {
      content: [
        {
          type: "text" as const,
          text: `No record of "${input.name}". It is new — pick a category from list_categories.`,
        },
      ],
    };
  }

  const parts = [
    `Merchant: ${memory.nameNorm}`,
    `Usual category: ${memory.categoryPath ?? "none learned yet"}`,
    `Seen: ${memory.seenCount} time${memory.seenCount === 1 ? "" : "s"}`,
  ];
  if (memory.averageMinor !== null) {
    parts.push(`Average amount: ${formatMinor(memory.averageMinor)}`);
  }

  return { content: [{ type: "text" as const, text: parts.join("\n") }] };
}
```

- [ ] **Step 2: Write the set_merchant_category tool**

`apps/server/src/mcp/tools/set-merchant-category.ts`:

```typescript
import { z } from "zod";
import { setMerchantCategory } from "../../services/merchants";

export const def = {
  name: "set_merchant_category",
  config: {
    title: "Pin a merchant to a category",
    description:
      "Sets the category a shop should default to from now on, overriding whatever was " +
      "learned automatically. Use when the user says something like \"Rossmann is household, " +
      "not groceries\". This affects future transactions only and does not rewrite past ones.",
    inputSchema: {
      name: z.string().describe("Merchant name"),
      category: z.string().describe('Category path, e.g. "Home/Cleaning"'),
    },
  },
};

export async function handler(input: { name: string; category: string }) {
  try {
    const updated = setMerchantCategory(input.name, input.category);
    return {
      content: [
        {
          type: "text" as const,
          text: `"${updated.nameNorm}" now defaults to ${updated.categoryPath}. Past transactions are unchanged.`,
        },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Could not set: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}
```

- [ ] **Step 3: Register both tools**

In `apps/server/src/mcp/index.ts`, add the imports beneath the existing ones:

```typescript
import { def as getMerchantDef, handler as getMerchantHandler } from "./tools/get-merchant";
import {
  def as setMerchantCategoryDef,
  handler as setMerchantCategoryHandler,
} from "./tools/set-merchant-category";
```

And the registrations beneath the existing two:

```typescript
server.registerTool(getMerchantDef.name, getMerchantDef.config, getMerchantHandler);
server.registerTool(
  setMerchantCategoryDef.name,
  setMerchantCategoryDef.config,
  setMerchantCategoryHandler,
);
```

- [ ] **Step 4: Point add_transactions at the new tool**

The existing description tells Claude to call `list_categories` first. It must now also mention `get_merchant`, otherwise the memory is written but never read.

In `apps/server/src/mcp/tools/add-transactions.ts`, replace this line of the description:

```typescript
      "Call list_categories first so category paths match the existing tree. " +
```

with:

```typescript
      "Call list_categories first so category paths match the existing tree, and call " +
      "get_merchant for each merchant to reuse the category that shop was filed under before. " +
```

- [ ] **Step 5: Verify the server still starts and lists four tools**

Run from `apps/server`:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | timeout 6 bun run src/mcp/index.ts 2>/dev/null | tail -1
```

Expected: the response lists `list_categories`, `add_transactions`, `get_merchant`, `set_merchant_category`.

- [ ] **Step 6: Typecheck**

Run: `cd apps/server && bunx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/mcp
git commit -m "feat: get_merchant and set_merchant_category MCP tools"
```

---

### Task 4: End-to-end verification of the memory loop

**Files:**
- Modify: `apps/server/scripts/mcp-e2e.ts`

**Interfaces:**
- Consumes: the four registered tools over stdio JSON-RPC.
- Produces: nothing importable — this is a verification script.

Phase 1's script proves the write path. This phase's claim is different and needs its own proof: that a category chosen once comes back on the next lookup, and that a correction sticks.

- [ ] **Step 1: Extend the script**

In `apps/server/scripts/mcp-e2e.ts`, insert before the final database summary block (the section beginning `const schemaCat = await import(...)`):

```typescript
const known = await send("tools/call", {
  name: "get_merchant",
  arguments: { name: "Żabka" },
});
console.log("9. get_merchant after one filing ->", text(known).replace(/\n+/g, " | "));

const unknown = await send("tools/call", {
  name: "get_merchant",
  arguments: { name: "Lidl" },
});
console.log("10. get_merchant for a new shop ->", text(unknown).replace(/\n+/g, " | "));

const bankSpelling = await send("tools/call", {
  name: "get_merchant",
  arguments: { name: "ZABKA" },
});
console.log("11. same shop, bank spelling ->", text(bankSpelling).replace(/\n+/g, " | "));

const pin = await send("tools/call", {
  name: "set_merchant_category",
  arguments: { name: "Żabka", category: "Home/Cleaning" },
});
console.log("12. pin to another category ->", text(pin).replace(/\n+/g, " | "));

const afterPin = await send("tools/call", {
  name: "get_merchant",
  arguments: { name: "Żabka" },
});
console.log("13. lookup after pinning ->", text(afterPin).replace(/\n+/g, " | "));
```

Note: step 6 of the existing script records a Żabka transaction without a breakdown, which teaches nothing. Add a categorized one so there is something to remember. Insert immediately after the existing step 6 block:

```typescript
const categorized = await send("tools/call", {
  name: "add_transactions",
  arguments: {
    items: [
      {
        date: "2026-08-12",
        total: "19.90",
        merchant: "Żabka",
        lineItems: [{ amount: "19.90", category: "Food/Groceries" }],
      },
    ],
  },
});
console.log("6b. categorized Żabka purchase ->", text(categorized).replace(/\n+/g, " | "));
```

- [ ] **Step 2: Run it**

Run: `cd apps/server && bun run mcp:e2e`

Expected output for the new steps:

- step 9 reports `Usual category: Food/Groceries` and `Seen: 2 times`
- step 10 reports that Lidl is new
- step 11 returns the same record as step 9, proving the bank spelling resolves to it
- step 12 confirms the pin
- step 13 reports `Usual category: Home/Cleaning`

If step 9 reports `none learned yet`, Task 1 did not wire `learnCategoryId` through — check that `addOne` passes it to `upsertMerchant`.

- [ ] **Step 3: Run the full suite one more time**

Run: `cd apps/server && bun test`
Expected: PASS, 79 tests.

- [ ] **Step 4: Commit**

```bash
git add apps/server/scripts/mcp-e2e.ts
git commit -m "test: end-to-end check of merchant memory loop"
```

---

## Definition of Done

- `bun test` passes: 79 tests.
- `bunx tsc --noEmit` exits 0.
- `bun run mcp:e2e` shows a category learned from one filing and returned on the next lookup, including under the bank's spelling.
- `set_merchant_category` overrides the learned default and leaves past transactions untouched.
- No MCP tool imports `db`.
- Recording the same shop twice in a row does not require choosing a category the second time.

## Deliberately not in this phase

- **Rewriting history when a default changes.** `setMerchantCategory` moves the default only. Bulk-rewriting past line items is `reassign_line_items`, phase 5 in the spec, and conflating the two would make a small correction silently rewrite months of data.
- **Matching receipts against statement entries.** Still phase 5, still keyed on amount and date rather than merchant name — the normalization ceiling documented in `dedup.ts` is why.
- **Suggesting a category for an unknown merchant.** Claude already does this from `list_categories`; a server-side guesser would duplicate it worse.
