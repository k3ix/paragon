# Paragon Phase 3 — HTTP API and the Read-Only Web View

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a page and see whether this month is normal — savings rate first, then where the money went, then the individual transactions.

**Architecture:** An Elysia HTTP server is added alongside the existing MCP server, both calling the same service layer. The frontend imports the server's type and gets a typed client through Eden Treaty, with no code generation step. This phase is read-only: editing is phase 4.

**Tech Stack:** Elysia 1.4, `@elysiajs/eden` 1.4, React 19, Vite 8, Tailwind v4, TanStack Query 5, Recharts 3, `bun:test`.

## Global Constraints

Everything from phases 1 and 2 still holds:

- **MCP tools and HTTP routes never import `db` or Drizzle.** Both call `src/services/`.
- **Tests run against a separate database file** via `test/helpers/db.ts`.
- **Money is an integer in minor units**; formatting happens at the edge, never in the service layer.
- **Dates are integer Unix seconds.**
- **Migrations are versioned files.** Never `db:push`.
- **Category depth is unlimited.** No component may assume a fixed number of levels.
- Package scope is `@paragon/*`.

New to this phase:

- **The frontend never computes money.** Aggregates come from the server already summed. A browser reducing `amountMinor` across a page of transactions is how two screens start disagreeing.
- **Every amount displayed passes through one formatter.** `formatMinor` lives in `packages/shared` so the server and the browser produce identical strings.

## Design direction

The skill's warning applies directly here: a dark dashboard with a big number and a gradient accent is the template answer for this exact brief. What follows is deliberately not that, and each choice is tied to the subject — a household ledger kept jointly, in two currencies, from receipts.

**Palette.** Ink-dark neutrals carrying a faint blue cast, so the surface reads like a ledger under lamplight rather than a terminal. Colour is data-bearing only: nothing is tinted for decoration.

```
--ink-900  #12151a   page
--ink-800  #171b21   raised surface
--ink-700  #222831   hairlines
--ink-300  #8b93a1   secondary text
--ink-100  #e6e8eb   primary text
--gain     #4ade80   money kept
--drain    #f87171   money spent above normal
--flag     #fbbf24   needs attention
```

`--gain` and `--drain` appear only on amounts and on the savings bars. Category colours are a separate ramp, assigned by rank so the same category keeps its colour across every chart on the page.

**Type.** Two roles, not three. Body and UI in Geist Variable, already vendored in Huntly. Every number — amounts, percentages, dates, counts — in a tabular-figure monospace so digits align in columns and a changing figure does not shift its neighbours. This is the one typographic commitment: in a ledger, columns of digits that do not line up are a defect, and most dashboards get this wrong by setting numbers in a proportional face.

**Layout.** A single column, max width 72rem, sections stacked in decreasing time horizon: the year, then the month, then the individual purchases. No sidebar — there are four screens in total and a persistent nav would be furniture.

```
┌──────────────────────────────────────────┐
│  paragon              August 2026   ‹ ›  │
├──────────────────────────────────────────┤
│  KEPT THIS MONTH                         │
│  31%                                     │
│  3 240 of 10 400 PLN · July was 24%      │
│  ▁▃▂▄▅▃▄▁▅▃▄█   ← 12 months              │
├──────────────────────────────────────────┤
│  income 10 400 │ spent 7 160 │ kept 3 240│
├──────────────────────────────────────────┤
│  WHERE IT WENT                           │
│   ◕  donut      Food        2 340   33%  │
│                 Home        1 720   24%  │
│                 Transport   1 150   16%  │
├──────────────────────────────────────────┤
│  INCOME AND SPENDING                     │
│  ╱╲╱─╲╱╲  two lines, 12 months           │
├──────────────────────────────────────────┤
│  PURCHASES                               │
│  9 Aug  Biedronka   groceries +2  −184.20│
└──────────────────────────────────────────┘
```

**Signature.** The savings-rate row is a twelve-month bar strip directly beneath the headline percentage, with the current month drawn in `--gain` and the eleven prior months in a muted tint. One glance answers "is this month normal" — which is the question the whole product exists to answer, and the reason a bare percentage on its own is not enough. Everything else on the page stays quiet so this row carries the weight.

**Restraint.** No card shadows, no gradients, no rounded-corner nesting beyond a single 10px radius, no icons except the month arrows. Hairlines separate sections. Motion is limited to a 150ms fade on data arrival; charts do not animate on every re-render, because a number that re-animates when you switch months reads as decoration.

Accessibility floor: keyboard focus visible on the month arrows and every table row, `prefers-reduced-motion` respected, colour never the sole carrier of meaning (amounts keep their minus sign, categories keep their labels).

## File Structure

```
packages/shared/src/
  money.ts                          MOVED from apps/server/src/money.ts
  schemas/summary.ts                NEW — response types shared by server and web

apps/server/src/
  money.ts                          DELETED — re-exported from shared
  services/summary.ts               NEW — monthly aggregates
  services/queries.ts               NEW — transaction list reads
  app.ts                            NEW — Elysia routes, exports `app` type
  index.ts                          NEW — HTTP entry point

apps/web/
  package.json, tsconfig.json, vite.config.ts, index.html
  src/main.tsx                      React root, QueryClient
  src/index.css                     theme tokens from the design direction
  src/api/client.ts                 Eden Treaty client
  src/api/queries.ts                TanStack Query hooks
  src/lib/format.ts                 display helpers over shared formatMinor
  src/components/MonthPicker.tsx
  src/components/SavingsHeadline.tsx    the signature element
  src/components/MonthTotals.tsx
  src/components/CategoryBreakdown.tsx  donut + ranked list
  src/components/TrendChart.tsx
  src/components/TransactionList.tsx
  src/App.tsx

apps/server/test/
  summary.test.ts                   NEW
  queries.test.ts                   NEW
  routes.test.ts                    NEW
```

`money.ts` moves to `packages/shared` because the browser must format amounts identically to the server. Leaving it in `apps/server` would mean a second implementation in the web app — exactly the divergence the constraint above forbids.

---

### Task 1: Move money formatting into the shared package

**Files:**
- Create: `packages/shared/src/money.ts`
- Modify: `packages/shared/src/index.ts`, `apps/server/src/money.ts`
- Test: `apps/server/test/money.test.ts` (unchanged, must still pass)

**Interfaces:**
- Consumes: nothing.
- Produces: `parseAmountToMinor` and `formatMinor` from `@paragon/shared`.

- [ ] **Step 1: Move the file**

```bash
git mv apps/server/src/money.ts packages/shared/src/money.ts
```

- [ ] **Step 2: Re-export from the shared barrel**

`packages/shared/src/index.ts` becomes:

```typescript
export * from "./enums";
export * from "./money";
export * from "./schemas/transaction";
```

- [ ] **Step 3: Keep the old import path working**

Create `apps/server/src/money.ts`:

```typescript
// Money formatting lives in the shared package so the browser renders amounts
// identically to the server. Re-exported here so existing imports keep working.
export { parseAmountToMinor, formatMinor } from "@paragon/shared";
```

- [ ] **Step 4: Verify nothing broke**

Run: `cd apps/server && bun test && bunx tsc --noEmit`
Expected: 79 tests pass, tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move money formatting into the shared package"
```

---

### Task 2: Summary service

**Files:**
- Create: `apps/server/src/services/summary.ts`, `packages/shared/src/schemas/summary.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `apps/server/test/summary.test.ts`

**Interfaces:**
- Consumes: `db`, `transactions`, `lineItems`, `categories` from `src/db/schema`.
- Produces: from `src/services/summary.ts`:
  - `getMonthSummary(month: string): MonthSummary`
  - `getMonthlyTrend(endMonth: string, count: number): TrendPoint[]`
  - `getCategoryBreakdown(month: string): CategorySlice[]`

And from `@paragon/shared`:

```typescript
export type MonthSummary = {
  month: string;            // "2026-08"
  incomeMinor: number;
  spentMinor: number;
  keptMinor: number;        // income − spent
  savingsRate: number | null; // percent, null when there was no income
};

export type TrendPoint = { month: string; incomeMinor: number; spentMinor: number; savingsRate: number | null };

export type CategorySlice = {
  categoryId: number | null;  // null groups everything uncategorized
  name: string;               // "Uncategorized" when categoryId is null
  path: string;
  totalMinor: number;
  share: number;              // percent of the month's spending
};
```

Transfers are excluded from every figure here. Moving money to savings is not spending and not income — counting it would make the savings rate meaningless, which is the whole reason `type` exists in the schema.

The breakdown groups by **top-level ancestor**, not by leaf category. A donut with nineteen slices tells you nothing; the drill-down into subcategories is phase 4. Rolling up requires walking each line's category to its root, and depth is unlimited.

- [ ] **Step 1: Write the shared types**

`packages/shared/src/schemas/summary.ts`:

```typescript
export type MonthSummary = {
  month: string;
  incomeMinor: number;
  spentMinor: number;
  keptMinor: number;
  savingsRate: number | null;
};

export type TrendPoint = {
  month: string;
  incomeMinor: number;
  spentMinor: number;
  savingsRate: number | null;
};

export type CategorySlice = {
  categoryId: number | null;
  name: string;
  path: string;
  totalMinor: number;
  share: number;
};
```

Add to `packages/shared/src/index.ts`:

```typescript
export * from "./schemas/summary";
```

- [ ] **Step 2: Write the failing test**

`apps/server/test/summary.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { createCategory } from "../src/services/categories";
import { addTransactions } from "../src/services/transactions";
import { getMonthSummary, getMonthlyTrend, getCategoryBreakdown } from "../src/services/summary";

beforeEach(() => {
  resetTestDb();
});

function seed() {
  const food = createCategory({ name: "Food" });
  createCategory({ name: "Groceries", parentId: food.id });
  createCategory({ name: "Restaurants", parentId: food.id });
  const home = createCategory({ name: "Home" });
  createCategory({ name: "Rent", parentId: home.id, isFixed: true });
  createCategory({ name: "Income" });
}

function expense(date: string, total: string, category: string, merchant = "Shop") {
  addTransactions([{ date, total, merchant, lineItems: [{ amount: total, category }] }]);
}

function income(date: string, total: string) {
  addTransactions([
    { date, total, type: "income", merchant: "Salary", lineItems: [{ amount: total, category: "Income" }] },
  ]);
}

describe("getMonthSummary", () => {
  it("returns zeros for a month with no data", () => {
    seed();
    const s = getMonthSummary("2026-08");
    expect(s.incomeMinor).toBe(0);
    expect(s.spentMinor).toBe(0);
    expect(s.keptMinor).toBe(0);
    expect(s.savingsRate).toBeNull();
  });

  it("sums income and spending for the month", () => {
    seed();
    income("2026-08-05", "10400.00");
    expense("2026-08-09", "184.20", "Food/Groceries");
    expense("2026-08-10", "1400.00", "Home/Rent");

    const s = getMonthSummary("2026-08");
    expect(s.incomeMinor).toBe(1040000);
    expect(s.spentMinor).toBe(158420);
    expect(s.keptMinor).toBe(881580);
  });

  it("computes the savings rate as a percentage of income", () => {
    seed();
    income("2026-08-05", "1000.00");
    expense("2026-08-09", "250.00", "Food/Groceries");

    expect(getMonthSummary("2026-08").savingsRate).toBe(75);
  });

  it("returns a null rate when there was no income", () => {
    seed();
    expense("2026-08-09", "250.00", "Food/Groceries");

    expect(getMonthSummary("2026-08").savingsRate).toBeNull();
  });

  it("reports a negative rate when spending exceeded income", () => {
    seed();
    income("2026-08-05", "1000.00");
    expense("2026-08-09", "1500.00", "Food/Groceries");

    expect(getMonthSummary("2026-08").savingsRate).toBe(-50);
  });

  it("ignores transfers entirely", () => {
    seed();
    income("2026-08-05", "1000.00");
    addTransactions([
      {
        date: "2026-08-06",
        total: "500.00",
        type: "transfer",
        note: "to savings",
        lineItems: [{ amount: "500.00", category: "Income" }],
      },
    ]);

    const s = getMonthSummary("2026-08");
    expect(s.incomeMinor).toBe(100000);
    expect(s.spentMinor).toBe(0);
  });

  it("excludes other months", () => {
    seed();
    expense("2026-07-31", "100.00", "Food/Groceries");
    expense("2026-08-01", "200.00", "Food/Groceries");
    expense("2026-09-01", "300.00", "Food/Groceries");

    expect(getMonthSummary("2026-08").spentMinor).toBe(20000);
  });
});

describe("getMonthlyTrend", () => {
  it("returns the requested number of months, oldest first", () => {
    seed();
    const trend = getMonthlyTrend("2026-08", 3);
    expect(trend.map((p) => p.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  it("includes months with no activity as zeros", () => {
    seed();
    expense("2026-08-09", "100.00", "Food/Groceries");

    const trend = getMonthlyTrend("2026-08", 3);
    expect(trend[0]!.spentMinor).toBe(0);
    expect(trend[2]!.spentMinor).toBe(10000);
  });

  it("crosses a year boundary correctly", () => {
    seed();
    const trend = getMonthlyTrend("2026-02", 4);
    expect(trend.map((p) => p.month)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("getCategoryBreakdown", () => {
  it("returns an empty array for a month with no spending", () => {
    seed();
    expect(getCategoryBreakdown("2026-08")).toEqual([]);
  });

  it("rolls subcategories up into their top-level ancestor", () => {
    seed();
    expense("2026-08-09", "100.00", "Food/Groceries");
    expense("2026-08-10", "50.00", "Food/Restaurants");
    expense("2026-08-11", "1400.00", "Home/Rent");

    const slices = getCategoryBreakdown("2026-08");
    expect(slices.map((s) => s.name)).toEqual(["Home", "Food"]);
    expect(slices.find((s) => s.name === "Food")!.totalMinor).toBe(15000);
  });

  it("orders by amount, largest first", () => {
    seed();
    expense("2026-08-09", "100.00", "Food/Groceries");
    expense("2026-08-11", "1400.00", "Home/Rent");

    expect(getCategoryBreakdown("2026-08")[0]!.name).toBe("Home");
  });

  it("computes each share as a percentage of the month", () => {
    seed();
    expense("2026-08-09", "250.00", "Food/Groceries");
    expense("2026-08-11", "750.00", "Home/Rent");

    const slices = getCategoryBreakdown("2026-08");
    expect(slices.find((s) => s.name === "Home")!.share).toBe(75);
    expect(slices.find((s) => s.name === "Food")!.share).toBe(25);
  });

  it("groups uncategorized lines under a single slice", () => {
    seed();
    addTransactions([{ date: "2026-08-09", total: "60.00", merchant: "Unknown" }]);

    const slices = getCategoryBreakdown("2026-08");
    expect(slices).toHaveLength(1);
    expect(slices[0]!.categoryId).toBeNull();
    expect(slices[0]!.name).toBe("Uncategorized");
  });

  it("excludes income and transfers", () => {
    seed();
    income("2026-08-05", "1000.00");
    expense("2026-08-09", "100.00", "Food/Groceries");

    const slices = getCategoryBreakdown("2026-08");
    expect(slices).toHaveLength(1);
    expect(slices[0]!.name).toBe("Food");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/server && bun test test/summary.test.ts`
Expected: FAIL — cannot resolve `../src/services/summary`.

- [ ] **Step 4: Implement**

`apps/server/src/services/summary.ts`:

```typescript
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { MonthSummary, TrendPoint, CategorySlice } from "@paragon/shared";
import { db } from "../db";
import { transactions, lineItems, categories } from "../db/schema";

export type { MonthSummary, TrendPoint, CategorySlice };

/** Unix-second bounds of a "YYYY-MM" month, half-open: [start, end). */
function monthBounds(month: string): { start: number; end: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month.trim());
  if (!match) throw new Error(`Invalid month, expected YYYY-MM: ${month}`);
  const year = Number(match[1]);
  const m = Number(match[2]);
  const start = Math.floor(Date.UTC(year, m - 1, 1) / 1000);
  const end = Math.floor(Date.UTC(m === 12 ? year + 1 : year, m === 12 ? 0 : m, 1) / 1000);
  return { start, end };
}

/** Shifts "YYYY-MM" by a signed number of months. */
function shiftMonth(month: string, delta: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month.trim());
  if (!match) throw new Error(`Invalid month, expected YYYY-MM: ${month}`);
  const total = Number(match[1]) * 12 + (Number(match[2]) - 1) + delta;
  const year = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${year}-${String(m).padStart(2, "0")}`;
}

/** Sum of transaction totals of one type within a month. Transfers are never counted. */
function totalOfType(start: number, end: number, type: "expense" | "income"): number {
  const row = db
    .select({ total: sql<number | null>`sum(${transactions.totalMinor})` })
    .from(transactions)
    .where(
      and(
        eq(transactions.type, type),
        gte(transactions.occurredOn, start),
        lt(transactions.occurredOn, end),
      ),
    )
    .get();
  return row?.total ?? 0;
}

export function getMonthSummary(month: string): MonthSummary {
  const { start, end } = monthBounds(month);
  const incomeMinor = totalOfType(start, end, "income");
  const spentMinor = totalOfType(start, end, "expense");
  const keptMinor = incomeMinor - spentMinor;

  return {
    month,
    incomeMinor,
    spentMinor,
    keptMinor,
    // A rate against zero income has no meaning; the UI shows a dash rather than 0%.
    savingsRate: incomeMinor === 0 ? null : Math.round((keptMinor / incomeMinor) * 100),
  };
}

export function getMonthlyTrend(endMonth: string, count: number): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const month = shiftMonth(endMonth, -i);
    const s = getMonthSummary(month);
    points.push({
      month,
      incomeMinor: s.incomeMinor,
      spentMinor: s.spentMinor,
      savingsRate: s.savingsRate,
    });
  }
  return points;
}

/**
 * Spending for a month grouped by top-level category.
 *
 * Lines are rolled up to their root ancestor: a nineteen-slice donut communicates
 * nothing, and drilling into subcategories is phase 4. Depth is unlimited, so the
 * walk loops rather than joining a fixed number of levels.
 */
export function getCategoryBreakdown(month: string): CategorySlice[] {
  const { start, end } = monthBounds(month);

  const rows = db
    .select({
      categoryId: lineItems.categoryId,
      amountMinor: lineItems.amountMinor,
    })
    .from(lineItems)
    .innerJoin(transactions, eq(lineItems.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.type, "expense"),
        gte(transactions.occurredOn, start),
        lt(transactions.occurredOn, end),
      ),
    )
    .all();

  if (rows.length === 0) return [];

  const all = db
    .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
    .from(categories)
    .all();
  const byId = new Map(all.map((c) => [c.id, c]));

  /** Walks to the root ancestor. The visited set guards against a parent cycle. */
  function rootOf(id: number): { id: number; name: string } | null {
    const visited = new Set<number>();
    let current = byId.get(id);
    while (current && current.parentId !== null && !visited.has(current.id)) {
      visited.add(current.id);
      const parent = byId.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return current ? { id: current.id, name: current.name } : null;
  }

  const buckets = new Map<number | null, { name: string; totalMinor: number }>();
  for (const row of rows) {
    const root = row.categoryId === null ? null : rootOf(row.categoryId);
    const key = root?.id ?? null;
    const name = root?.name ?? "Uncategorized";
    const bucket = buckets.get(key) ?? { name, totalMinor: 0 };
    bucket.totalMinor += row.amountMinor;
    buckets.set(key, bucket);
  }

  const total = [...buckets.values()].reduce((sum, b) => sum + b.totalMinor, 0);

  return [...buckets.entries()]
    .map(([categoryId, b]) => ({
      categoryId,
      name: b.name,
      path: b.name,
      totalMinor: b.totalMinor,
      share: total === 0 ? 0 : Math.round((b.totalMinor / total) * 100),
    }))
    .sort((a, b) => b.totalMinor - a.totalMinor);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/server && bun test test/summary.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/summary.ts apps/server/test/summary.test.ts packages/shared/src
git commit -m "feat: monthly summary, trend and category breakdown"
```

---

### Task 3: Transaction list queries

**Files:**
- Create: `apps/server/src/services/queries.ts`
- Test: `apps/server/test/queries.test.ts`

**Interfaces:**
- Consumes: `db` and the schema tables; `buildCategoryPath` behaviour is duplicated here deliberately — see the note below.
- Produces: from `src/services/queries.ts`:

```typescript
export type TransactionRow = {
  id: number;
  occurredOn: number;
  type: string;
  totalMinor: number;
  currency: string;
  merchantRaw: string | null;
  note: string | null;
  lines: { id: number; amountMinor: number; categoryPath: string | null; note: string | null }[];
};

export function listTransactions(filter: {
  month?: string;
  type?: string;
  limit?: number;
  offset?: number;
}): { rows: TransactionRow[]; total: number };
```

The list returns each transaction with its lines attached, because the UI shows "groceries +2" — the first category plus a count — and computing that in the browser would mean a second round trip per row.

- [ ] **Step 1: Write the failing test**

`apps/server/test/queries.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { createCategory } from "../src/services/categories";
import { addTransactions } from "../src/services/transactions";
import { listTransactions } from "../src/services/queries";

beforeEach(() => {
  resetTestDb();
});

function seed() {
  const food = createCategory({ name: "Food" });
  createCategory({ name: "Groceries", parentId: food.id });
  const home = createCategory({ name: "Home" });
  createCategory({ name: "Cleaning", parentId: home.id });
  createCategory({ name: "Income" });
}

describe("listTransactions", () => {
  it("returns an empty result when there is nothing", () => {
    seed();
    const { rows, total } = listTransactions({});
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });

  it("returns newest first", () => {
    seed();
    addTransactions([
      { date: "2026-08-01", total: "10.00", merchant: "A", lineItems: [{ amount: "10.00", category: "Food/Groceries" }] },
      { date: "2026-08-09", total: "20.00", merchant: "B", lineItems: [{ amount: "20.00", category: "Food/Groceries" }] },
    ]);

    const { rows } = listTransactions({});
    expect(rows.map((r) => r.merchantRaw)).toEqual(["B", "A"]);
  });

  it("attaches line items with their category paths", () => {
    seed();
    addTransactions([
      {
        date: "2026-08-09",
        total: "184.20",
        merchant: "Biedronka",
        lineItems: [
          { amount: "146.20", category: "Food/Groceries" },
          { amount: "38.00", category: "Home/Cleaning" },
        ],
      },
    ]);

    const { rows } = listTransactions({});
    expect(rows[0]!.lines).toHaveLength(2);
    expect(rows[0]!.lines.map((l) => l.categoryPath).sort()).toEqual([
      "Food/Groceries",
      "Home/Cleaning",
    ]);
  });

  it("reports a null category path for an uncategorized line", () => {
    seed();
    addTransactions([{ date: "2026-08-09", total: "23.50", merchant: "Unknown" }]);

    const { rows } = listTransactions({});
    expect(rows[0]!.lines[0]!.categoryPath).toBeNull();
  });

  it("filters by month", () => {
    seed();
    addTransactions([
      { date: "2026-07-31", total: "10.00", merchant: "July", lineItems: [{ amount: "10.00", category: "Food/Groceries" }] },
      { date: "2026-08-01", total: "20.00", merchant: "August", lineItems: [{ amount: "20.00", category: "Food/Groceries" }] },
    ]);

    const { rows, total } = listTransactions({ month: "2026-08" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.merchantRaw).toBe("August");
    expect(total).toBe(1);
  });

  it("filters by type", () => {
    seed();
    addTransactions([
      { date: "2026-08-01", total: "10.00", merchant: "Shop", lineItems: [{ amount: "10.00", category: "Food/Groceries" }] },
      { date: "2026-08-05", total: "1000.00", type: "income", merchant: "Salary", lineItems: [{ amount: "1000.00", category: "Income" }] },
    ]);

    const { rows } = listTransactions({ type: "income" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.merchantRaw).toBe("Salary");
  });

  it("paginates and reports the unpaginated total", () => {
    seed();
    addTransactions([
      { date: "2026-08-01", total: "10.00", merchant: "A", lineItems: [{ amount: "10.00", category: "Food/Groceries" }] },
      { date: "2026-08-02", total: "20.00", merchant: "B", lineItems: [{ amount: "20.00", category: "Food/Groceries" }] },
      { date: "2026-08-03", total: "30.00", merchant: "C", lineItems: [{ amount: "30.00", category: "Food/Groceries" }] },
    ]);

    const { rows, total } = listTransactions({ limit: 2 });
    expect(rows).toHaveLength(2);
    expect(total).toBe(3);

    const second = listTransactions({ limit: 2, offset: 2 });
    expect(second.rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && bun test test/queries.test.ts`
Expected: FAIL — cannot resolve `../src/services/queries`.

- [ ] **Step 3: Implement**

`apps/server/src/services/queries.ts`:

```typescript
import { and, desc, eq, gte, lt, sql, inArray } from "drizzle-orm";
import { db } from "../db";
import { transactions, lineItems, categories } from "../db/schema";

export type TransactionLine = {
  id: number;
  amountMinor: number;
  categoryPath: string | null;
  note: string | null;
};

export type TransactionRow = {
  id: number;
  occurredOn: number;
  type: string;
  totalMinor: number;
  currency: string;
  merchantRaw: string | null;
  note: string | null;
  lines: TransactionLine[];
};

/** Unix-second bounds of a "YYYY-MM" month, half-open: [start, end). */
function monthBounds(month: string): { start: number; end: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month.trim());
  if (!match) throw new Error(`Invalid month, expected YYYY-MM: ${month}`);
  const year = Number(match[1]);
  const m = Number(match[2]);
  return {
    start: Math.floor(Date.UTC(year, m - 1, 1) / 1000),
    end: Math.floor(Date.UTC(m === 12 ? year + 1 : year, m === 12 ? 0 : m, 1) / 1000),
  };
}

/** Builds every category's full path in one pass, so rows do not query per line. */
function categoryPaths(): Map<number, string> {
  const all = db
    .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
    .from(categories)
    .all();
  const byId = new Map(all.map((c) => [c.id, c]));
  const paths = new Map<number, string>();

  for (const category of all) {
    const segments: string[] = [];
    const visited = new Set<number>();
    let current: (typeof all)[number] | undefined = category;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      segments.unshift(current.name);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    paths.set(category.id, segments.join("/"));
  }

  return paths;
}

export function listTransactions(filter: {
  month?: string;
  type?: string;
  limit?: number;
  offset?: number;
}): { rows: TransactionRow[]; total: number } {
  const conditions = [];
  if (filter.month) {
    const { start, end } = monthBounds(filter.month);
    conditions.push(gte(transactions.occurredOn, start));
    conditions.push(lt(transactions.occurredOn, end));
  }
  if (filter.type) conditions.push(eq(transactions.type, filter.type));
  const where = conditions.length ? and(...conditions) : undefined;

  const countRow = db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(where)
    .get();
  const total = countRow?.count ?? 0;

  const txRows = db
    .select()
    .from(transactions)
    .where(where)
    .orderBy(desc(transactions.occurredOn), desc(transactions.id))
    .limit(filter.limit ?? 100)
    .offset(filter.offset ?? 0)
    .all();

  if (txRows.length === 0) return { rows: [], total };

  const paths = categoryPaths();
  const lineRows = db
    .select()
    .from(lineItems)
    .where(
      inArray(
        lineItems.transactionId,
        txRows.map((t) => t.id),
      ),
    )
    .all();

  const linesByTx = new Map<number, TransactionLine[]>();
  for (const line of lineRows) {
    const list = linesByTx.get(line.transactionId) ?? [];
    list.push({
      id: line.id,
      amountMinor: line.amountMinor,
      categoryPath: line.categoryId === null ? null : (paths.get(line.categoryId) ?? null),
      note: line.note,
    });
    linesByTx.set(line.transactionId, list);
  }

  return {
    rows: txRows.map((t) => ({
      id: t.id,
      occurredOn: t.occurredOn,
      type: t.type,
      totalMinor: t.totalMinor,
      currency: t.currency,
      merchantRaw: t.merchantRaw,
      note: t.note,
      lines: linesByTx.get(t.id) ?? [],
    })),
    total,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/server && bun test test/queries.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/queries.ts apps/server/test/queries.test.ts
git commit -m "feat: transaction list queries with attached line items"
```

---

### Task 4: Elysia HTTP server

**Files:**
- Create: `apps/server/src/app.ts`, `apps/server/src/index.ts`
- Modify: `apps/server/package.json`
- Test: `apps/server/test/routes.test.ts`

**Interfaces:**
- Consumes: every service written so far.
- Produces: `app` from `src/app.ts` — its **type** is what the frontend imports. `bun run dev` starts it on port 3000.

Routes stay thin: parse, call a service, return. Any logic here would be logic the MCP tools do not have.

- [ ] **Step 1: Add dependencies**

```bash
cd apps/server && bun add elysia @elysiajs/cors
```

Add to `apps/server/package.json` scripts:

```json
    "dev": "bun run --watch src/index.ts",
```

- [ ] **Step 2: Write the failing test**

`apps/server/test/routes.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { app } from "../src/app";
import { createCategory } from "../src/services/categories";
import { addTransactions } from "../src/services/transactions";

async function api(path: string) {
  return app.handle(new Request(`http://localhost${path}`));
}

beforeEach(() => {
  resetTestDb();
});

function seed() {
  const food = createCategory({ name: "Food" });
  createCategory({ name: "Groceries", parentId: food.id });
  createCategory({ name: "Income" });
}

describe("GET /api/categories", () => {
  it("returns the category tree", async () => {
    seed();
    const res = await api("/api/categories");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].children[0].name).toBe("Groceries");
  });
});

describe("GET /api/summary", () => {
  it("returns the month summary", async () => {
    seed();
    addTransactions([
      { date: "2026-08-05", total: "1000.00", type: "income", merchant: "Salary", lineItems: [{ amount: "1000.00", category: "Income" }] },
      { date: "2026-08-09", total: "250.00", merchant: "Shop", lineItems: [{ amount: "250.00", category: "Food/Groceries" }] },
    ]);

    const res = await api("/api/summary?month=2026-08");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.savingsRate).toBe(75);
    expect(body.spentMinor).toBe(25000);
  });

  it("rejects a malformed month", async () => {
    seed();
    const res = await api("/api/summary?month=nonsense");
    expect(res.status).toBe(422);
  });
});

describe("GET /api/trend", () => {
  it("returns the requested span, oldest first", async () => {
    seed();
    const res = await api("/api/trend?month=2026-08&count=3");
    const body = await res.json();
    expect(body.map((p: { month: string }) => p.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });
});

describe("GET /api/breakdown", () => {
  it("returns category slices for the month", async () => {
    seed();
    addTransactions([
      { date: "2026-08-09", total: "250.00", merchant: "Shop", lineItems: [{ amount: "250.00", category: "Food/Groceries" }] },
    ]);

    const res = await api("/api/breakdown?month=2026-08");
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("Food");
    expect(body[0].share).toBe(100);
  });
});

describe("GET /api/transactions", () => {
  it("returns rows with their lines and a total", async () => {
    seed();
    addTransactions([
      { date: "2026-08-09", total: "250.00", merchant: "Shop", lineItems: [{ amount: "250.00", category: "Food/Groceries" }] },
    ]);

    const res = await api("/api/transactions?month=2026-08");
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.rows[0].lines[0].categoryPath).toBe("Food/Groceries");
  });
});

describe("GET /api/merchants", () => {
  it("returns known merchants", async () => {
    seed();
    addTransactions([
      { date: "2026-08-09", total: "250.00", merchant: "Biedronka", lineItems: [{ amount: "250.00", category: "Food/Groceries" }] },
    ]);

    const res = await api("/api/merchants");
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].nameNorm).toBe("biedronka");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/server && bun test test/routes.test.ts`
Expected: FAIL — cannot resolve `../src/app`.

- [ ] **Step 4: Implement the routes**

`apps/server/src/app.ts`:

```typescript
import { Elysia, t } from "elysia";
import { listCategories } from "./services/categories";
import { getMonthSummary, getMonthlyTrend, getCategoryBreakdown } from "./services/summary";
import { listTransactions } from "./services/queries";
import { listMerchants } from "./services/merchants";

// "YYYY-MM". Elysia validates the shape and returns 422 before the handler runs.
const monthQuery = t.Object({ month: t.String({ pattern: "^\\d{4}-\\d{2}$" }) });

export const app = new Elysia({ prefix: "/api" })
  .get("/categories", () => listCategories())

  .get("/summary", ({ query }) => getMonthSummary(query.month), { query: monthQuery })

  .get("/trend", ({ query }) => getMonthlyTrend(query.month, query.count ?? 12), {
    query: t.Object({
      month: t.String({ pattern: "^\\d{4}-\\d{2}$" }),
      count: t.Optional(t.Number({ minimum: 1, maximum: 60 })),
    }),
  })

  .get("/breakdown", ({ query }) => getCategoryBreakdown(query.month), { query: monthQuery })

  .get(
    "/transactions",
    ({ query }) =>
      listTransactions({
        month: query.month,
        type: query.type,
        limit: query.limit,
        offset: query.offset,
      }),
    {
      query: t.Object({
        month: t.Optional(t.String({ pattern: "^\\d{4}-\\d{2}$" })),
        type: t.Optional(t.String()),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 500 })),
        offset: t.Optional(t.Number({ minimum: 0 })),
      }),
    },
  )

  .get("/merchants", () => listMerchants());

export type App = typeof app;
```

`apps/server/src/index.ts`:

```typescript
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { app } from "./app";

// Vite proxies /api during development, so requests are same-origin and CORS is not
// strictly needed. It is enabled anyway for the case of opening a built bundle or a
// separate client directly against this port.
const server = new Elysia().use(cors()).use(app).listen(3000);

console.log(`Paragon API on http://localhost:${server.server?.port}`);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/server && bun test test/routes.test.ts`
Expected: PASS, 7 tests.

If the malformed-month test returns 200 rather than 422, the `pattern` constraint is missing from that route's query schema.

- [ ] **Step 6: Confirm the server actually serves**

```bash
cd apps/server && (bun run src/index.ts &) && sleep 1 && \
  curl -s "http://localhost:3000/api/categories" | head -c 200 && echo && \
  curl -s "http://localhost:3000/api/summary?month=2026-08" && echo && \
  pkill -f "src/index.ts"
```

Expected: the category tree as JSON, then a summary object.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/app.ts apps/server/src/index.ts apps/server/package.json apps/server/test/routes.test.ts
git commit -m "feat: Elysia HTTP API over the existing services"
```

---

### Task 5: Web app skeleton and typed client

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/index.css`, `apps/web/src/api/client.ts`, `apps/web/src/api/queries.ts`, `apps/web/src/lib/format.ts`, `apps/web/src/App.tsx`
- Test: verified by the dev server rendering real data

**Interfaces:**
- Consumes: `type App` from `apps/server/src/app`; `formatMinor` from `@paragon/shared`.
- Produces: `client` and the hooks `useSummary`, `useTrend`, `useBreakdown`, `useTransactions`, `useCategories`.

- [ ] **Step 1: Create the package manifest**

`apps/web/package.json`:

```json
{
  "name": "@paragon/web",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@elysiajs/eden": "^1.4.9",
    "@paragon/shared": "workspace:*",
    "@tanstack/react-query": "^5.101.4",
    "react": "^19.2.8",
    "react-dom": "^19.2.8",
    "recharts": "^3.10.1"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.3.3",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^6.0.5",
    "tailwindcss": "^4.3.3",
    "typescript": "^5.7.0",
    "vite": "^8.2.1"
  }
}
```

Run `bun install` from the repository root afterwards.

- [ ] **Step 2: Configure Vite and TypeScript**

`apps/web/vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:3000", changeOrigin: true } },
  },
});
```

`apps/web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "types": ["vite/client"],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts"]
}
```

`apps/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Paragon</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Write the theme**

`apps/web/src/index.css` — the palette and type from the design direction, nothing more:

```css
@import "tailwindcss";
@import "@fontsource-variable/geist";

@theme {
  --color-ink-900: #12151a;
  --color-ink-800: #171b21;
  --color-ink-700: #222831;
  --color-ink-500: #3f4652;
  --color-ink-300: #8b93a1;
  --color-ink-100: #e6e8eb;
  --color-gain: #4ade80;
  --color-drain: #f87171;
  --color-flag: #fbbf24;

  /* Category ramp, assigned by rank so a category keeps its colour page-wide. */
  --color-slice-1: #4ade80;
  --color-slice-2: #60a5fa;
  --color-slice-3: #fbbf24;
  --color-slice-4: #f87171;
  --color-slice-5: #a78bfa;
  --color-slice-6: #5eead4;

  --font-sans: "Geist Variable", system-ui, sans-serif;
  --radius-card: 10px;
}

:root {
  color-scheme: dark;
}

body {
  background: var(--color-ink-900);
  color: var(--color-ink-100);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

/*
 * Every figure on the page uses tabular digits. In a ledger, columns of numbers
 * that do not line up are a defect, and a changing value must not shift its
 * neighbours.
 */
.tnum {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}

:focus-visible {
  outline: 2px solid var(--color-gain);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

Add `@fontsource-variable/geist` to dependencies: `cd apps/web && bun add @fontsource-variable/geist`.

- [ ] **Step 4: Wire the typed client**

`apps/web/src/api/client.ts`:

```typescript
import { treaty } from "@elysiajs/eden";
import type { App } from "../../../server/src/app";

// The type is imported from the server directly — no code generation, no schema
// file to regenerate. Changing a route's shape breaks the build here.
export const client = treaty<App>(window.location.origin);
```

`apps/web/src/api/queries.ts`:

```typescript
import { useQuery } from "@tanstack/react-query";
import { client } from "./client";

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await client.api.categories.get();
      if (error) throw error;
      return data;
    },
  });
}

export function useSummary(month: string) {
  return useQuery({
    queryKey: ["summary", month],
    queryFn: async () => {
      const { data, error } = await client.api.summary.get({ query: { month } });
      if (error) throw error;
      return data;
    },
  });
}

export function useTrend(month: string, count = 12) {
  return useQuery({
    queryKey: ["trend", month, count],
    queryFn: async () => {
      const { data, error } = await client.api.trend.get({ query: { month, count } });
      if (error) throw error;
      return data;
    },
  });
}

export function useBreakdown(month: string) {
  return useQuery({
    queryKey: ["breakdown", month],
    queryFn: async () => {
      const { data, error } = await client.api.breakdown.get({ query: { month } });
      if (error) throw error;
      return data;
    },
  });
}

export function useTransactions(month: string, limit = 50) {
  return useQuery({
    queryKey: ["transactions", month, limit],
    queryFn: async () => {
      const { data, error } = await client.api.transactions.get({ query: { month, limit } });
      if (error) throw error;
      return data;
    },
  });
}
```

`apps/web/src/lib/format.ts`:

```typescript
import { formatMinor } from "@paragon/shared";

/** Amount with a thousands separator, e.g. "1 234.56". Sign is kept. */
export function money(minor: number): string {
  const [whole, fraction] = formatMinor(minor).split(".");
  const negative = whole!.startsWith("-");
  const digits = negative ? whole!.slice(1) : whole!;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${negative ? "−" : ""}${grouped}.${fraction}`;
}

/** "2026-08" to "August 2026". */
export function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  const date = new Date(Date.UTC(Number(year), Number(m) - 1, 1));
  return date.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Unix seconds to "9 Aug". */
export function dayLabel(occurredOn: number): string {
  return new Date(occurredOn * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** The current month as "YYYY-MM". */
export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Shifts "YYYY-MM" by a signed number of months. */
export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  const total = year! * 12 + (m! - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}
```

- [ ] **Step 5: Mount the app**

`apps/web/src/main.tsx`:

```typescript
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
```

`apps/web/src/App.tsx` — a placeholder proving the pipe works end to end:

```typescript
import { useState } from "react";
import { useSummary } from "./api/queries";
import { currentMonth, money } from "./lib/format";

export function App() {
  const [month] = useState(currentMonth);
  const summary = useSummary(month);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-sm uppercase tracking-widest text-ink-300">Paragon</h1>
      {summary.isLoading && <p className="mt-8 text-ink-300">Loading…</p>}
      {summary.isError && <p className="mt-8 text-drain">Could not reach the server.</p>}
      {summary.data && (
        <p className="tnum mt-8 text-5xl font-semibold">
          {summary.data.savingsRate === null ? "—" : `${summary.data.savingsRate}%`}
        </p>
      )}
      {summary.data && (
        <p className="tnum mt-2 text-ink-300">
          {money(summary.data.keptMinor)} of {money(summary.data.incomeMinor)} PLN
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 6: Verify the pipe end to end**

Seed a month of data into the working database first, so the page has something to show:

```bash
cd apps/server && bun -e '
import { createCategory, listCategories } from "./src/services/categories";
import { addTransactions } from "./src/services/transactions";
const has = (n: string) => listCategories().some((c) => c.name === n);
if (!has("Income")) createCategory({ name: "Income" });
addTransactions([
  { date: "2026-08-05", total: "10400.00", type: "income", merchant: "Salary", lineItems: [{ amount: "10400.00", category: "Income" }] },
  { date: "2026-08-09", total: "184.20", merchant: "Biedronka", lineItems: [{ amount: "146.20", category: "Food/Groceries" }, { amount: "38.00", category: "Home/Cleaning" }] },
  { date: "2026-08-10", total: "1400.00", merchant: "Landlord", lineItems: [{ amount: "1400.00", category: "Home/Rent" }] },
]);
console.log("seeded");
'
```

Then run both processes and open the page:

```bash
cd apps/server && bun run dev &
cd apps/web && bun run dev
```

Expected: `http://localhost:5173` shows a savings percentage and the two amounts beneath it, in tabular figures.

- [ ] **Step 7: Typecheck**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: exit 0. If the client's response types resolve to `unknown`, the `App` type export in `apps/server/src/app.ts` is missing.

- [ ] **Step 8: Commit**

```bash
git add apps/web bun.lock
git commit -m "feat: web skeleton with typed Eden client"
```

---

### Task 6: The dashboard

**Files:**
- Create: `apps/web/src/components/MonthPicker.tsx`, `SavingsHeadline.tsx`, `MonthTotals.tsx`, `CategoryBreakdown.tsx`, `TrendChart.tsx`, `TransactionList.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: visual verification against the design direction

**Interfaces:**
- Consumes: the hooks from Task 5, the formatters from `lib/format`.
- Produces: the assembled page.

Build in the order the page reads: month picker, savings headline, totals, breakdown, trend, transactions.

- [ ] **Step 1: Month picker**

`apps/web/src/components/MonthPicker.tsx`:

```typescript
import { monthLabel, shiftMonth } from "../lib/format";

export function MonthPicker({
  month,
  onChange,
}: {
  month: string;
  onChange: (month: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-ink-100">{monthLabel(month)}</span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onChange(shiftMonth(month, -1))}
          aria-label="Previous month"
          className="rounded px-2 py-1 text-ink-300 hover:bg-ink-800 hover:text-ink-100"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => onChange(shiftMonth(month, 1))}
          aria-label="Next month"
          className="rounded px-2 py-1 text-ink-300 hover:bg-ink-800 hover:text-ink-100"
        >
          ›
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: The signature element — savings headline with its twelve-month strip**

`apps/web/src/components/SavingsHeadline.tsx`:

```typescript
import type { MonthSummary, TrendPoint } from "@paragon/shared";
import { money } from "../lib/format";

/**
 * The page's one loud element: the current rate, and immediately beneath it the
 * eleven months before it, so "is this month normal" is answered in a glance
 * rather than by remembering last month's number.
 */
export function SavingsHeadline({
  summary,
  trend,
}: {
  summary: MonthSummary;
  trend: TrendPoint[];
}) {
  const rates = trend.map((p) => p.savingsRate ?? 0);
  const peak = Math.max(...rates.map(Math.abs), 1);
  const previous = trend.at(-2);

  return (
    <section>
      <h2 className="text-xs uppercase tracking-widest text-ink-300">Kept this month</h2>

      <p className="tnum mt-3 text-6xl leading-none font-semibold">
        {summary.savingsRate === null ? (
          <span className="text-ink-300">—</span>
        ) : (
          <span className={summary.savingsRate >= 0 ? "text-gain" : "text-drain"}>
            {summary.savingsRate}%
          </span>
        )}
      </p>

      <p className="tnum mt-3 text-sm text-ink-300">
        {money(summary.keptMinor)} of {money(summary.incomeMinor)} PLN
        {previous?.savingsRate !== null && previous !== undefined && (
          <> · previous month {previous.savingsRate}%</>
        )}
      </p>

      <div className="mt-5 flex h-14 items-end gap-1" aria-hidden="true">
        {trend.map((point, index) => {
          const rate = point.savingsRate ?? 0;
          const height = Math.max((Math.abs(rate) / peak) * 100, 2);
          const isCurrent = index === trend.length - 1;
          return (
            <div
              key={point.month}
              style={{ height: `${height}%` }}
              className={`flex-1 rounded-t-sm ${
                isCurrent ? "bg-gain" : rate < 0 ? "bg-drain/40" : "bg-gain/30"
              }`}
            />
          );
        })}
      </div>
      <p className="mt-2 text-xs text-ink-300">
        {trend[0]?.month} — {trend.at(-1)?.month}
      </p>
    </section>
  );
}
```

- [ ] **Step 3: Month totals**

`apps/web/src/components/MonthTotals.tsx`:

```typescript
import type { MonthSummary } from "@paragon/shared";
import { money } from "../lib/format";

export function MonthTotals({ summary }: { summary: MonthSummary }) {
  const cells = [
    { label: "Income", value: summary.incomeMinor, tone: "text-gain" },
    { label: "Spent", value: summary.spentMinor, tone: "text-ink-100" },
    { label: "Kept", value: summary.keptMinor, tone: summary.keptMinor >= 0 ? "text-gain" : "text-drain" },
  ];

  return (
    <section className="grid grid-cols-3 gap-6 border-t border-ink-700 pt-6">
      {cells.map((cell) => (
        <div key={cell.label}>
          <p className="text-xs uppercase tracking-widest text-ink-300">{cell.label}</p>
          <p className={`tnum mt-2 text-2xl font-medium ${cell.tone}`}>{money(cell.value)}</p>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 4: Category breakdown**

`apps/web/src/components/CategoryBreakdown.tsx`:

```typescript
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import type { CategorySlice } from "@paragon/shared";
import { money } from "../lib/format";

const RAMP = [
  "var(--color-slice-1)",
  "var(--color-slice-2)",
  "var(--color-slice-3)",
  "var(--color-slice-4)",
  "var(--color-slice-5)",
  "var(--color-slice-6)",
];

export function CategoryBreakdown({ slices }: { slices: CategorySlice[] }) {
  if (slices.length === 0) {
    return (
      <section className="border-t border-ink-700 pt-6">
        <h2 className="text-xs uppercase tracking-widest text-ink-300">Where it went</h2>
        <p className="mt-4 text-sm text-ink-300">No spending recorded this month.</p>
      </section>
    );
  }

  const total = slices.reduce((sum, s) => sum + s.totalMinor, 0);

  return (
    <section className="border-t border-ink-700 pt-6">
      <h2 className="text-xs uppercase tracking-widest text-ink-300">Where it went</h2>

      <div className="mt-5 grid gap-8 md:grid-cols-[200px_1fr]">
        <div className="relative h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="totalMinor"
                innerRadius={62}
                outerRadius={88}
                startAngle={90}
                endAngle={-270}
                stroke="none"
                isAnimationActive={false}
              >
                {slices.map((slice, index) => (
                  <Cell key={slice.categoryId ?? "none"} fill={RAMP[index % RAMP.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="tnum text-lg font-medium">{money(total)}</span>
            <span className="text-xs text-ink-300">PLN</span>
          </div>
        </div>

        <ul>
          {slices.map((slice, index) => (
            <li
              key={slice.categoryId ?? "none"}
              className="flex items-center justify-between border-b border-ink-700 py-2 last:border-0"
            >
              <span className="flex items-center gap-2 text-sm">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: RAMP[index % RAMP.length] }}
                />
                {slice.name}
              </span>
              <span className="tnum text-sm">
                {money(slice.totalMinor)}
                <span className="ml-3 text-ink-300">{slice.share}%</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Trend chart**

`apps/web/src/components/TrendChart.tsx`:

```typescript
import { Line, LineChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import type { TrendPoint } from "@paragon/shared";
import { money } from "../lib/format";

export function TrendChart({ trend }: { trend: TrendPoint[] }) {
  const data = trend.map((p) => ({
    month: p.month.slice(5),
    income: p.incomeMinor / 100,
    spent: p.spentMinor / 100,
  }));

  return (
    <section className="border-t border-ink-700 pt-6">
      <h2 className="text-xs uppercase tracking-widest text-ink-300">Income and spending</h2>

      <div className="mt-5 h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <XAxis
              dataKey="month"
              tick={{ fill: "var(--color-ink-300)", fontSize: 11 }}
              axisLine={{ stroke: "var(--color-ink-700)" }}
              tickLine={false}
            />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                background: "var(--color-ink-800)",
                border: "1px solid var(--color-ink-700)",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--color-ink-300)" }}
              formatter={(value: number) => money(Math.round(value * 100))}
            />
            <Line
              type="monotone"
              dataKey="income"
              stroke="var(--color-gain)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="spent"
              stroke="var(--color-drain)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-3 flex gap-5 text-xs text-ink-300">
        <span className="flex items-center gap-2">
          <span className="inline-block h-px w-4 bg-gain" /> income
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-px w-4 bg-drain" /> spent
        </span>
      </p>
    </section>
  );
}
```

- [ ] **Step 6: Transaction list**

`apps/web/src/components/TransactionList.tsx`:

```typescript
import { dayLabel, money } from "../lib/format";

type Row = {
  id: number;
  occurredOn: number;
  type: string;
  totalMinor: number;
  merchantRaw: string | null;
  lines: { id: number; categoryPath: string | null }[];
};

/** "groceries +2" — the first category plus how many others share the receipt. */
function categoryLabel(lines: Row["lines"]): string {
  const first = lines[0]?.categoryPath;
  const leaf = first ? (first.split("/").at(-1) ?? first) : "uncategorized";
  return lines.length > 1 ? `${leaf} +${lines.length - 1}` : leaf;
}

export function TransactionList({ rows }: { rows: Row[] }) {
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

      <table className="mt-4 w-full text-sm">
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-ink-700 last:border-0">
              <td className="tnum w-16 py-2.5 text-ink-300">{dayLabel(row.occurredOn)}</td>
              <td className="py-2.5">{row.merchantRaw ?? "—"}</td>
              <td className="py-2.5">
                <span className="rounded bg-ink-800 px-2 py-0.5 text-xs text-ink-300">
                  {row.type === "transfer" ? "transfer" : categoryLabel(row.lines)}
                </span>
              </td>
              <td
                className={`tnum py-2.5 text-right ${
                  row.type === "income" ? "text-gain" : row.type === "transfer" ? "text-ink-300" : ""
                }`}
              >
                {row.type === "expense" ? "−" : row.type === "income" ? "+" : ""}
                {money(row.totalMinor)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 7: Assemble the page**

`apps/web/src/App.tsx`:

```typescript
import { useState } from "react";
import { useSummary, useTrend, useBreakdown, useTransactions } from "./api/queries";
import { currentMonth } from "./lib/format";
import { MonthPicker } from "./components/MonthPicker";
import { SavingsHeadline } from "./components/SavingsHeadline";
import { MonthTotals } from "./components/MonthTotals";
import { CategoryBreakdown } from "./components/CategoryBreakdown";
import { TrendChart } from "./components/TrendChart";
import { TransactionList } from "./components/TransactionList";

export function App() {
  const [month, setMonth] = useState(currentMonth);

  const summary = useSummary(month);
  const trend = useTrend(month, 12);
  const breakdown = useBreakdown(month);
  const transactions = useTransactions(month);

  const failed = summary.isError || trend.isError || breakdown.isError || transactions.isError;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-baseline justify-between">
        <h1 className="text-sm uppercase tracking-widest text-ink-300">Paragon</h1>
        <MonthPicker month={month} onChange={setMonth} />
      </header>

      {failed && (
        <p className="mt-10 text-drain">
          Could not reach the server. Start it with <code>bun run dev</code> in apps/server.
        </p>
      )}

      {!failed && (
        <div className="mt-10 space-y-8">
          {summary.data && trend.data && (
            <SavingsHeadline summary={summary.data} trend={trend.data} />
          )}
          {summary.data && <MonthTotals summary={summary.data} />}
          {breakdown.data && <CategoryBreakdown slices={breakdown.data} />}
          {trend.data && <TrendChart trend={trend.data} />}
          {transactions.data && <TransactionList rows={transactions.data.rows} />}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 8: Verify against the design direction**

Run both dev servers and open `http://localhost:5173`. Check each point:

- the savings percentage is the largest thing on the page, with the twelve-month strip directly beneath it
- every figure uses tabular digits — switching months must not shift the columns
- colour appears only on amounts, savings bars and category dots; nothing is tinted decoratively
- sections are separated by hairlines, not cards with shadows
- tabbing reaches both month arrows with a visible focus ring
- at 375px wide the page does not scroll horizontally

- [ ] **Step 9: Typecheck and build**

Run: `cd apps/web && bun run build`
Expected: tsc passes, Vite produces `dist/`.

- [ ] **Step 10: Commit**

```bash
git add apps/web
git commit -m "feat: read-only dashboard"
```

---

## Definition of Done

- `bun test` passes from the repository root: 109 tests.
- `bunx tsc --noEmit` exits 0 in both `apps/server` and `apps/web`.
- `apps/web` builds.
- Opening the page shows the current month's savings rate, totals, category donut, twelve-month trend and the transaction list, all from the real database.
- Switching months updates every section.
- The MCP server still works: `cd apps/server && bun run mcp:e2e`.
- No HTTP route or MCP tool imports `db`.

## Deliberately not in this phase

- **Editing.** Clicking a row does nothing yet; click-to-edit, the category tree and the merchant list are phase 4.
- **Drilling into subcategories.** The donut rolls everything up to top-level. Clicking a slice to expand it belongs with the editing work, since both need the category tree component.
- **Fixed versus discretionary.** `is_fixed` is stored and returned but no screen uses it — that split needs three months of history to be worth reading.
- **Currency switching.** Everything renders in PLN. Income in EUR is converted at its stored rate on write; a display toggle waits until the data shows it is needed.
- **Authentication.** The server binds to localhost and is not exposed. Phase 6 revisits this if the app is ever hosted.
