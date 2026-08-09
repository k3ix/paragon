# Paragon Phase 6 — Summaries, Export and Backup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ask "how was August compared to July" in a chat and get an answer; take the whole history out as a file; and stop a corrupted database from being the end of the project.

**Architecture:** A `get_summary` service adds the period-over-period delta the spec asks for and is exposed as the sixth MCP tool. Export and backup are two small services with HTTP routes. Backup uses SQLite's `VACUUM INTO` rather than copying the file, because the database runs in WAL mode.

**Tech Stack:** Unchanged — Bun, Elysia, Drizzle, `bun:test`.

## Why backup is in scope

The research behind the spec found losing history to be the third most common reason people abandon expense trackers — one person lost ten years. This phase is the last one in the spec, so it is the last chance to add the thing whose absence is only discovered when it is too late.

## Global Constraints

Everything from phases 1–5 still holds:

- **MCP tools and HTTP routes never import `db` or Drizzle.** Both call `src/services/`.
- **Tests run against a separate database file** via `test/helpers/db.ts`.
- **Money is an integer in minor units.** Dates are Unix seconds; months go through `src/services/month.ts`.
- **Category depth is unlimited.**
- **`onError` sets a status without a body.**
- **`app.handle()` needs a real hostname** — `http://localhost/...`, never `http://x/...`.

New to this phase:

- **A backup is never a plain file copy.** The database runs in WAL mode, so recent writes live in `paragon.db-wal`. Copying only `paragon.db` produces a file that opens cleanly and is missing data — the worst kind of broken backup. `VACUUM INTO` writes a consistent single-file snapshot.
- **Export is generated from services, not from raw tables.** The CSV a person opens should carry category paths and decimal amounts, not foreign keys and minor units.

## File Structure

```
apps/server/src/services/
  report.ts                    NEW — getSummary with period deltas
  export.ts                    NEW — CSV and JSON serialisation
  backup.ts                    NEW — VACUUM INTO plus retention
apps/server/src/mcp/tools/
  get-summary.ts               NEW — { def, handler }
apps/server/src/mcp/index.ts   MODIFY — register it
apps/server/src/app.ts         MODIFY — export and backup routes
apps/server/test/
  report.test.ts               NEW
  export.test.ts               NEW
  backup.test.ts               NEW
```

---

### Task 1: Summary with period deltas

**Files:**
- Create: `apps/server/src/services/report.ts`
- Test: `apps/server/test/report.test.ts`

**Interfaces:**
- Consumes: `getMonthSummary`, `getCategoryBreakdown` from `./summary`; `shiftMonth` from `./month`; `listMerchants` from `./merchants`.
- Produces:

```typescript
export type CategoryDelta = {
  name: string;
  totalMinor: number;
  previousMinor: number;
  deltaMinor: number;
  deltaPercent: number | null;  // null when the previous period was zero
};

export type PeriodSummary = {
  month: string;
  incomeMinor: number;
  spentMinor: number;
  keptMinor: number;
  savingsRate: number | null;
  previous: {
    month: string;
    spentMinor: number;
    savingsRate: number | null;
  };
  spentDeltaMinor: number;
  categories: CategoryDelta[];
};

export function getSummary(month: string): PeriodSummary;
```

The delta is the point. "You spent 7 160 in August" tells you nothing on its own; "7 160, which is 8% more than July, and groceries are up 42%" is a conclusion. The research behind the spec found that the most common reason people abandon trackers is logging faithfully for months and never seeing anything stand out.

`deltaPercent` is null rather than zero or infinity when the previous month had nothing in that category — a category that did not exist last month has no percentage change, and rendering "+∞%" would be noise.

- [ ] **Step 1: Write the failing test**

`apps/server/test/report.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { createCategory } from "../src/services/categories";
import { addTransactions } from "../src/services/transactions";
import { getSummary } from "../src/services/report";

beforeEach(() => {
  resetTestDb();
});

function seed() {
  const food = createCategory({ name: "Food" });
  createCategory({ name: "Groceries", parentId: food.id });
  const home = createCategory({ name: "Home" });
  createCategory({ name: "Rent", parentId: home.id, isFixed: true });
  createCategory({ name: "Income" });
}

function expense(date: string, total: string, category: string, merchant = "Shop") {
  addTransactions([{ date, total, merchant, lineItems: [{ amount: total, category }] }]);
}

function income(date: string, total: string) {
  addTransactions([
    {
      date,
      total,
      type: "income",
      merchant: "Salary",
      lineItems: [{ amount: total, category: "Income" }],
    },
  ]);
}

describe("getSummary", () => {
  it("reports the month's own figures", () => {
    seed();
    income("2026-08-05", "1000.00");
    expense("2026-08-09", "250.00", "Food/Groceries");

    const s = getSummary("2026-08");
    expect(s.incomeMinor).toBe(100000);
    expect(s.spentMinor).toBe(25000);
    expect(s.savingsRate).toBe(75);
  });

  it("names the previous month and its spending", () => {
    seed();
    expense("2026-07-09", "100.00", "Food/Groceries");
    expense("2026-08-09", "250.00", "Food/Groceries");

    const s = getSummary("2026-08");
    expect(s.previous.month).toBe("2026-07");
    expect(s.previous.spentMinor).toBe(10000);
  });

  it("computes the spending delta against the previous month", () => {
    seed();
    expense("2026-07-09", "100.00", "Food/Groceries");
    expense("2026-08-09", "250.00", "Food/Groceries");

    expect(getSummary("2026-08").spentDeltaMinor).toBe(15000);
  });

  it("reports a negative delta when spending fell", () => {
    seed();
    expense("2026-07-09", "300.00", "Food/Groceries");
    expense("2026-08-09", "100.00", "Food/Groceries");

    expect(getSummary("2026-08").spentDeltaMinor).toBe(-20000);
  });

  it("reports per-category change against the previous month", () => {
    seed();
    expense("2026-07-09", "100.00", "Food/Groceries");
    expense("2026-08-09", "142.00", "Food/Groceries");

    const food = getSummary("2026-08").categories.find((c) => c.name === "Food")!;
    expect(food.totalMinor).toBe(14200);
    expect(food.previousMinor).toBe(10000);
    expect(food.deltaMinor).toBe(4200);
    expect(food.deltaPercent).toBe(42);
  });

  it("returns a null percentage for a category that is new this month", () => {
    seed();
    expense("2026-08-09", "100.00", "Food/Groceries");

    const food = getSummary("2026-08").categories.find((c) => c.name === "Food")!;
    expect(food.previousMinor).toBe(0);
    expect(food.deltaPercent).toBeNull();
  });

  it("includes a category that disappeared this month", () => {
    seed();
    expense("2026-07-09", "100.00", "Food/Groceries");
    expense("2026-08-09", "200.00", "Home/Rent");

    // Spending nothing on food after spending 100 last month is worth reporting.
    const food = getSummary("2026-08").categories.find((c) => c.name === "Food")!;
    expect(food.totalMinor).toBe(0);
    expect(food.previousMinor).toBe(10000);
    expect(food.deltaMinor).toBe(-10000);
    expect(food.deltaPercent).toBe(-100);
  });

  it("orders categories by this month's spending, largest first", () => {
    seed();
    expense("2026-08-09", "100.00", "Food/Groceries");
    expense("2026-08-10", "300.00", "Home/Rent");

    expect(getSummary("2026-08").categories[0]!.name).toBe("Home");
  });

  it("crosses a year boundary when naming the previous month", () => {
    seed();
    expense("2025-12-09", "100.00", "Food/Groceries");
    expense("2026-01-09", "200.00", "Food/Groceries");

    const s = getSummary("2026-01");
    expect(s.previous.month).toBe("2025-12");
    expect(s.previous.spentMinor).toBe(10000);
  });

  it("handles a month with no history before it", () => {
    seed();
    expense("2026-08-09", "100.00", "Food/Groceries");

    const s = getSummary("2026-08");
    expect(s.previous.spentMinor).toBe(0);
    expect(s.spentDeltaMinor).toBe(10000);
  });

  it("rejects an invalid month", () => {
    seed();
    expect(() => getSummary("2026-13")).toThrow(/month/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && bun test test/report.test.ts`
Expected: FAIL — cannot resolve `../src/services/report`.

- [ ] **Step 3: Implement**

`apps/server/src/services/report.ts`:

```typescript
import type { CategorySlice } from "@paragon/shared";
import { getMonthSummary, getCategoryBreakdown } from "./summary";
import { shiftMonth } from "./month";

export type CategoryDelta = {
  name: string;
  totalMinor: number;
  previousMinor: number;
  deltaMinor: number;
  deltaPercent: number | null;
};

export type PeriodSummary = {
  month: string;
  incomeMinor: number;
  spentMinor: number;
  keptMinor: number;
  savingsRate: number | null;
  previous: { month: string; spentMinor: number; savingsRate: number | null };
  spentDeltaMinor: number;
  categories: CategoryDelta[];
};

function byName(slices: CategorySlice[]): Map<string, number> {
  return new Map(slices.map((s) => [s.name, s.totalMinor]));
}

/**
 * A month's figures alongside the month before it.
 *
 * The comparison is the whole point: a total on its own says nothing, while "8% more
 * than last month, and groceries up 42%" is a conclusion. The research behind the spec
 * found the commonest reason people abandon trackers is logging faithfully and never
 * seeing anything stand out.
 */
export function getSummary(month: string): PeriodSummary {
  const current = getMonthSummary(month);
  const previousMonth = shiftMonth(month, -1);
  const previous = getMonthSummary(previousMonth);

  const currentSlices = byName(getCategoryBreakdown(month));
  const previousSlices = byName(getCategoryBreakdown(previousMonth));

  // A category that vanished this month is as informative as one that appeared, so
  // the union of both months is walked rather than just this month's.
  const names = new Set([...currentSlices.keys(), ...previousSlices.keys()]);

  const categories: CategoryDelta[] = [...names]
    .map((name) => {
      const totalMinor = currentSlices.get(name) ?? 0;
      const previousMinor = previousSlices.get(name) ?? 0;
      return {
        name,
        totalMinor,
        previousMinor,
        deltaMinor: totalMinor - previousMinor,
        // No baseline means no percentage: "+∞%" for a brand-new category is noise.
        deltaPercent:
          previousMinor === 0
            ? null
            : Math.round(((totalMinor - previousMinor) / previousMinor) * 100),
      };
    })
    .sort((a, b) => b.totalMinor - a.totalMinor);

  return {
    month,
    incomeMinor: current.incomeMinor,
    spentMinor: current.spentMinor,
    keptMinor: current.keptMinor,
    savingsRate: current.savingsRate,
    previous: {
      month: previousMonth,
      spentMinor: previous.spentMinor,
      savingsRate: previous.savingsRate,
    },
    spentDeltaMinor: current.spentMinor - previous.spentMinor,
    categories,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/server && bun test test/report.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/report.ts apps/server/test/report.test.ts
git commit -m "feat: month summary with period-over-period deltas"
```

---

### Task 2: The get_summary MCP tool

**Files:**
- Create: `apps/server/src/mcp/tools/get-summary.ts`
- Modify: `apps/server/src/mcp/index.ts`, `apps/server/src/app.ts`
- Test: append to `apps/server/test/routes.test.ts`

**Interfaces:**
- Consumes: `getSummary` from `../../services/report`; `formatMinor` from `../../money`.
- Produces: the `get_summary` tool and `GET /api/report?month=YYYY-MM`.

The tool returns prose rather than JSON. Claude is going to read it aloud to a person, and a table of minor units would have to be translated first — the translation is the same every time, so the server does it once.

- [ ] **Step 1: Write the tool**

`apps/server/src/mcp/tools/get-summary.ts`:

```typescript
import { z } from "zod";
import { getSummary } from "../../services/report";
import { formatMinor } from "../../money";

export const def = {
  name: "get_summary",
  config: {
    title: "Summarise a month",
    description:
      "Reports a month's income, spending and savings rate, how each compares with the " +
      "month before, and which categories moved most. Use for questions like " +
      '"how was August", "what changed since July" or "where did the money go". ' +
      "Amounts are in PLN.",
    inputSchema: {
      month: z.string().describe('Month to summarise, "YYYY-MM"'),
    },
  },
};

/** "+42%" / "−12%" / "new" — the shape a person reads rather than a raw ratio. */
function changeLabel(delta: CategoryChange): string {
  if (delta.deltaPercent === null) return delta.totalMinor === 0 ? "gone" : "new";
  const sign = delta.deltaPercent > 0 ? "+" : "";
  return `${sign}${delta.deltaPercent}%`;
}

type CategoryChange = {
  name: string;
  totalMinor: number;
  previousMinor: number;
  deltaMinor: number;
  deltaPercent: number | null;
};

export async function handler(input: { month: string }) {
  try {
    const s = getSummary(input.month);

    const rate = s.savingsRate === null ? "n/a (no income recorded)" : `${s.savingsRate}%`;
    const previousRate = s.previous.savingsRate === null ? "n/a" : `${s.previous.savingsRate}%`;
    const spentChange =
      s.spentDeltaMinor === 0
        ? "the same as"
        : `${formatMinor(Math.abs(s.spentDeltaMinor))} ${s.spentDeltaMinor > 0 ? "more" : "less"} than`;

    const lines = [
      `${s.month}`,
      `  Income:  ${formatMinor(s.incomeMinor)}`,
      `  Spent:   ${formatMinor(s.spentMinor)} — ${spentChange} ${s.previous.month}`,
      `  Kept:    ${formatMinor(s.keptMinor)} (${rate}, previously ${previousRate})`,
      "",
      "  By category:",
      ...s.categories
        .filter((c) => c.totalMinor > 0 || c.previousMinor > 0)
        .map(
          (c) =>
            `    ${c.name}: ${formatMinor(c.totalMinor)} (${changeLabel(c)}, was ${formatMinor(c.previousMinor)})`,
        ),
    ];

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Could not summarise: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}
```

- [ ] **Step 2: Register it**

In `apps/server/src/mcp/index.ts`:

```typescript
import { def as getSummaryDef, handler as getSummaryHandler } from "./tools/get-summary";
```

```typescript
server.registerTool(getSummaryDef.name, getSummaryDef.config, getSummaryHandler);
```

- [ ] **Step 3: Add the HTTP route**

In `apps/server/src/app.ts`, import `getSummary` from `./services/report` and add:

```typescript
  .get("/report", ({ query }) => getSummary(query.month), { query: monthQuery })
```

- [ ] **Step 4: Write the route test**

Append to `apps/server/test/routes.test.ts`:

```typescript
describe("GET /api/report", () => {
  it("returns the month with its deltas", async () => {
    seed();
    addTransactions([
      {
        date: "2026-07-09",
        total: "100.00",
        merchant: "Shop",
        lineItems: [{ amount: "100.00", category: "Food/Groceries" }],
      },
      {
        date: "2026-08-09",
        total: "250.00",
        merchant: "Shop",
        lineItems: [{ amount: "250.00", category: "Food/Groceries" }],
      },
    ]);

    const res = await api("/api/report?month=2026-08");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.spentMinor).toBe(25000);
    expect(body.previous.month).toBe("2026-07");
    expect(body.spentDeltaMinor).toBe(15000);
  });

  it("rejects an invalid month", async () => {
    seed();
    const res = await api("/api/report?month=2026-13");
    expect(res.status).toBe(422);
  });
});
```

- [ ] **Step 5: Verify**

Run: `cd apps/server && bun test && bunx tsc --noEmit`
Expected: 184 tests pass, tsc exits 0.

Then confirm six tools are registered:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | timeout 6 bun run src/mcp/index.ts 2>/dev/null | tail -1 \
  | python3 -c "import sys,json; print(', '.join(t['name'] for t in json.load(sys.stdin)['result']['tools']))"
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/mcp apps/server/src/app.ts apps/server/test/routes.test.ts
git commit -m "feat: get_summary tool and report route"
```

---

### Task 3: Export

**Files:**
- Create: `apps/server/src/services/export.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/test/export.test.ts`

**Interfaces:**
- Consumes: `listTransactions` from `./queries`; `formatMinor` from `../money`.
- Produces:

```typescript
export function exportCsv(filter?: { month?: string }): string;
export function exportJson(filter?: { month?: string }): string;
```

And the routes `GET /api/export.csv` and `GET /api/export.json`.

One row per **line item**, not per transaction: a receipt split three ways is three rows, each with its own category, and the transaction id ties them together. Exporting one row per transaction would drop the breakdown that the whole model exists to record.

- [ ] **Step 1: Write the failing test**

`apps/server/test/export.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { createCategory } from "../src/services/categories";
import { addTransactions } from "../src/services/transactions";
import { exportCsv, exportJson } from "../src/services/export";

beforeEach(() => {
  resetTestDb();
});

function seed() {
  const food = createCategory({ name: "Food" });
  createCategory({ name: "Groceries", parentId: food.id });
  const home = createCategory({ name: "Home" });
  createCategory({ name: "Cleaning", parentId: home.id });
}

describe("exportCsv", () => {
  it("emits a header even with no data", () => {
    seed();
    const csv = exportCsv();
    expect(csv.split("\n")[0]).toBe(
      "date,merchant,category,amount,currency,type,transaction_id,note",
    );
  });

  it("writes one row per line item", () => {
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

    const rows = exportCsv().trim().split("\n");
    expect(rows).toHaveLength(3); // header plus two lines
  });

  it("writes amounts as decimals, not minor units", () => {
    seed();
    addTransactions([
      {
        date: "2026-08-09",
        total: "184.20",
        merchant: "Biedronka",
        lineItems: [{ amount: "184.20", category: "Food/Groceries" }],
      },
    ]);

    expect(exportCsv()).toContain("184.20");
    expect(exportCsv()).not.toContain("18420");
  });

  it("writes the category as a full path", () => {
    seed();
    addTransactions([
      {
        date: "2026-08-09",
        total: "10.00",
        merchant: "Shop",
        lineItems: [{ amount: "10.00", category: "Food/Groceries" }],
      },
    ]);

    expect(exportCsv()).toContain("Food/Groceries");
  });

  it("writes an ISO date", () => {
    seed();
    addTransactions([
      {
        date: "2026-08-09",
        total: "10.00",
        merchant: "Shop",
        lineItems: [{ amount: "10.00", category: "Food/Groceries" }],
      },
    ]);

    expect(exportCsv()).toContain("2026-08-09");
  });

  it("quotes a field containing a comma", () => {
    seed();
    addTransactions([
      {
        date: "2026-08-09",
        total: "10.00",
        merchant: "Shop, the second",
        lineItems: [{ amount: "10.00", category: "Food/Groceries" }],
      },
    ]);

    expect(exportCsv()).toContain('"Shop, the second"');
  });

  it("escapes a quote inside a field", () => {
    seed();
    addTransactions([
      {
        date: "2026-08-09",
        total: "10.00",
        merchant: 'The "Good" Shop',
        lineItems: [{ amount: "10.00", category: "Food/Groceries" }],
      },
    ]);

    expect(exportCsv()).toContain('"The ""Good"" Shop"');
  });

  it("restricts to a month when asked", () => {
    seed();
    addTransactions([
      {
        date: "2026-07-09",
        total: "10.00",
        merchant: "July",
        lineItems: [{ amount: "10.00", category: "Food/Groceries" }],
      },
      {
        date: "2026-08-09",
        total: "20.00",
        merchant: "August",
        lineItems: [{ amount: "20.00", category: "Food/Groceries" }],
      },
    ]);

    const csv = exportCsv({ month: "2026-08" });
    expect(csv).toContain("August");
    expect(csv).not.toContain("July");
  });

  it("writes an empty category for an uncategorized line", () => {
    seed();
    addTransactions([{ date: "2026-08-09", total: "10.00", merchant: "Unknown" }]);

    const row = exportCsv().trim().split("\n")[1]!;
    expect(row.split(",")[2]).toBe("");
  });
});

describe("exportJson", () => {
  it("emits valid JSON with the transactions", () => {
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

    const parsed = JSON.parse(exportJson());
    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.transactions[0].lines).toHaveLength(2);
  });

  it("keeps minor units so the export can be re-imported without rounding", () => {
    seed();
    addTransactions([
      {
        date: "2026-08-09",
        total: "184.20",
        merchant: "Biedronka",
        lineItems: [{ amount: "184.20", category: "Food/Groceries" }],
      },
    ]);

    const parsed = JSON.parse(exportJson());
    expect(parsed.transactions[0].totalMinor).toBe(18420);
  });

  it("records when the export was taken", () => {
    seed();
    const parsed = JSON.parse(exportJson());
    expect(typeof parsed.exportedAt).toBe("number");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && bun test test/export.test.ts`
Expected: FAIL — cannot resolve `../src/services/export`.

- [ ] **Step 3: Implement**

`apps/server/src/services/export.ts`:

```typescript
import { formatMinor } from "../money";
import { listTransactions } from "./queries";

/** Wraps a field in quotes when it contains a comma, quote or newline. */
function csvField(value: string | null): string {
  const text = value ?? "";
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Unix seconds to "YYYY-MM-DD". */
function isoDate(occurredOn: number): string {
  return new Date(occurredOn * 1000).toISOString().slice(0, 10);
}

const HEADER = "date,merchant,category,amount,currency,type,transaction_id,note";

/**
 * One row per line item, not per transaction.
 *
 * A receipt split three ways is three rows sharing a transaction id. Collapsing to one
 * row per transaction would discard the breakdown the data model exists to record.
 * Amounts are decimals here because this file is meant to be opened by a person.
 */
export function exportCsv(filter?: { month?: string }): string {
  const { rows } = listTransactions({ month: filter?.month, limit: 100_000 });

  const lines = rows.flatMap((tx) =>
    tx.lines.map((line) =>
      [
        isoDate(tx.occurredOn),
        csvField(tx.merchantRaw),
        csvField(line.categoryPath),
        formatMinor(line.amountMinor),
        tx.currency,
        tx.type,
        String(tx.id),
        csvField(line.note ?? tx.note),
      ].join(","),
    ),
  );

  return [HEADER, ...lines].join("\n") + "\n";
}

/**
 * The full history as JSON, in minor units.
 *
 * Unlike the CSV, this is meant to be read back by a machine, so amounts stay integral
 * and nothing is rounded on the way out.
 */
export function exportJson(filter?: { month?: string }): string {
  const { rows, total } = listTransactions({ month: filter?.month, limit: 100_000 });

  return JSON.stringify(
    {
      exportedAt: Math.floor(Date.now() / 1000),
      count: total,
      transactions: rows,
    },
    null,
    2,
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/server && bun test test/export.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Add the routes**

In `apps/server/src/app.ts`, import the service and add:

```typescript
  .get(
    "/export.csv",
    ({ query, set }) => {
      set.headers["content-type"] = "text/csv; charset=utf-8";
      set.headers["content-disposition"] = `attachment; filename="paragon-${query.month ?? "all"}.csv"`;
      return exportCsv({ month: query.month });
    },
    { query: t.Object({ month: t.Optional(t.String({ pattern: monthPattern })) }) },
  )

  .get(
    "/export.json",
    ({ query, set }) => {
      set.headers["content-type"] = "application/json; charset=utf-8";
      set.headers["content-disposition"] = `attachment; filename="paragon-${query.month ?? "all"}.json"`;
      return exportJson({ month: query.month });
    },
    { query: t.Object({ month: t.Optional(t.String({ pattern: monthPattern })) }) },
  )
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/export.ts apps/server/src/app.ts apps/server/test/export.test.ts
git commit -m "feat: CSV and JSON export"
```

---

### Task 4: Backup

**Files:**
- Create: `apps/server/src/services/backup.ts`
- Modify: `apps/server/src/app.ts`, `apps/server/package.json`
- Test: `apps/server/test/backup.test.ts`

**Interfaces:**
- Consumes: `sqlite` from `../db`.
- Produces:

```typescript
export function createBackup(directory?: string): { path: string; sizeBytes: number };
export function listBackups(directory?: string): { path: string; takenAt: number; sizeBytes: number }[];
export function pruneBackups(keep: number, directory?: string): { removed: number };
```

And `POST /api/backup`, plus a `bun run backup` script for cron.

**Why not a file copy.** The database runs in WAL mode: recent writes sit in `paragon.db-wal` until a checkpoint. Copying `paragon.db` alone yields a file that opens without complaint and is silently missing the newest data — a backup that looks fine until the day it is needed. `VACUUM INTO` asks SQLite for a consistent single-file snapshot instead.

- [ ] **Step 1: Write the failing test**

`apps/server/test/backup.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync, readdirSync } from "node:fs";
import { Database } from "bun:sqlite";
import { resetTestDb } from "./helpers/db";
import { createCategory } from "../src/services/categories";
import { addTransactions } from "../src/services/transactions";
import { createBackup, listBackups, pruneBackups } from "../src/services/backup";

const DIR = "/tmp/paragon-backup-test";

beforeEach(() => {
  resetTestDb();
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
});

afterEach(() => {
  rmSync(DIR, { recursive: true, force: true });
});

function seed() {
  const food = createCategory({ name: "Food" });
  createCategory({ name: "Groceries", parentId: food.id });
  addTransactions([
    {
      date: "2026-08-09",
      total: "184.20",
      merchant: "Biedronka",
      lineItems: [{ amount: "184.20", category: "Food/Groceries" }],
    },
  ]);
}

describe("createBackup", () => {
  it("writes a file", () => {
    seed();
    const result = createBackup(DIR);
    expect(existsSync(result.path)).toBe(true);
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it("produces a database that actually opens and holds the data", () => {
    seed();
    const { path } = createBackup(DIR);

    // The point of VACUUM INTO over a file copy: WAL contents are included.
    const restored = new Database(path, { readonly: true });
    const rows = restored.query("SELECT total_minor FROM transactions").all() as {
      total_minor: number;
    }[];
    restored.close();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.total_minor).toBe(18420);
  });

  it("includes writes made moments earlier", () => {
    seed();
    // A plain copy of the .db file would miss this, since it is still in the WAL.
    addTransactions([
      {
        date: "2026-08-10",
        total: "23.50",
        merchant: "Żabka",
        lineItems: [{ amount: "23.50", category: "Food/Groceries" }],
      },
    ]);

    const { path } = createBackup(DIR);
    const restored = new Database(path, { readonly: true });
    const count = restored.query("SELECT count(*) as n FROM transactions").get() as { n: number };
    restored.close();

    expect(count.n).toBe(2);
  });

  it("names the file with a sortable timestamp", () => {
    seed();
    const { path } = createBackup(DIR);
    expect(path).toMatch(/paragon-\d{8}-\d{6}\.db$/);
  });
});

describe("listBackups", () => {
  it("returns an empty list for a directory with none", () => {
    expect(listBackups(DIR)).toEqual([]);
  });

  it("lists what was written, newest first", async () => {
    seed();
    createBackup(DIR);
    // The filename carries whole seconds, so two in the same second would collide.
    await Bun.sleep(1100);
    createBackup(DIR);

    const backups = listBackups(DIR);
    expect(backups).toHaveLength(2);
    expect(backups[0]!.takenAt).toBeGreaterThanOrEqual(backups[1]!.takenAt);
  });

  it("ignores unrelated files", () => {
    seed();
    createBackup(DIR);
    Bun.write(`${DIR}/notes.txt`, "not a backup");

    expect(listBackups(DIR)).toHaveLength(1);
  });
});

describe("pruneBackups", () => {
  it("keeps the newest and removes the rest", async () => {
    seed();
    createBackup(DIR);
    await Bun.sleep(1100);
    createBackup(DIR);
    await Bun.sleep(1100);
    createBackup(DIR);

    const result = pruneBackups(2, DIR);
    expect(result.removed).toBe(1);
    expect(listBackups(DIR)).toHaveLength(2);
  });

  it("removes nothing when there are fewer than the limit", () => {
    seed();
    createBackup(DIR);

    expect(pruneBackups(30, DIR).removed).toBe(0);
    expect(listBackups(DIR)).toHaveLength(1);
  });

  it("refuses to keep zero", () => {
    // Pruning to nothing is never intended and would delete every backup.
    expect(() => pruneBackups(0, DIR)).toThrow(/keep/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && bun test test/backup.test.ts`
Expected: FAIL — cannot resolve `../src/services/backup`.

- [ ] **Step 3: Implement**

`apps/server/src/services/backup.ts`:

```typescript
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { sqlite } from "../db";

const DEFAULT_DIR = join(import.meta.dir, "..", "..", "backups");
const FILENAME = /^paragon-(\d{8})-(\d{6})\.db$/;

/** "paragon-20260809-143052.db" — sortable, and readable at a glance. */
function timestampName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `paragon-${date}-${time}.db`;
}

/**
 * Writes a consistent snapshot of the database.
 *
 * VACUUM INTO rather than copying the file: the database runs in WAL mode, so recent
 * writes live in paragon.db-wal until a checkpoint. A copy of paragon.db alone opens
 * without complaint and is silently missing the newest rows — a backup that looks fine
 * until the day it is needed.
 */
export function createBackup(directory: string = DEFAULT_DIR): {
  path: string;
  sizeBytes: number;
} {
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });

  const path = join(directory, timestampName(new Date()));
  sqlite.exec("VACUUM INTO ?", [path] as never);

  return { path, sizeBytes: statSync(path).size };
}

export function listBackups(
  directory: string = DEFAULT_DIR,
): { path: string; takenAt: number; sizeBytes: number }[] {
  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter((name) => FILENAME.test(name))
    .map((name) => {
      const path = join(directory, name);
      return { path, takenAt: statSync(path).mtimeMs / 1000, sizeBytes: statSync(path).size };
    })
    .sort((a, b) => b.takenAt - a.takenAt);
}

/** Deletes all but the newest `keep` backups. */
export function pruneBackups(
  keep: number,
  directory: string = DEFAULT_DIR,
): { removed: number } {
  if (keep < 1) throw new Error("Backup retention must keep at least one file.");

  const stale = listBackups(directory).slice(keep);
  for (const backup of stale) rmSync(backup.path, { force: true });

  return { removed: stale.length };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/server && bun test test/backup.test.ts`
Expected: PASS, 10 tests.

If `VACUUM INTO` throws about binding, the parameter form differs in this Bun version — substitute the path into the statement directly, and note in a comment that the value is server-generated rather than user input.

- [ ] **Step 5: Add the route and the cron script**

In `apps/server/src/app.ts`:

```typescript
  .post("/backup", () => {
    const result = createBackup();
    // Thirty days of daily snapshots, matching the spec's retention.
    const pruned = pruneBackups(30);
    return { ...result, removed: pruned.removed };
  })
```

Create `apps/server/scripts/backup.ts`:

```typescript
import { createBackup, pruneBackups, listBackups } from "../src/services/backup";

const result = createBackup();
const pruned = pruneBackups(30);

console.log(
  `Backup written: ${result.path} (${Math.round(result.sizeBytes / 1024)} KB). ` +
    `${listBackups().length} kept, ${pruned.removed} removed.`,
);
```

Add to `apps/server/package.json` scripts:

```json
    "backup": "bun run scripts/backup.ts",
```

Add `backups/` to the repository `.gitignore`.

- [ ] **Step 6: Verify it runs for real**

```bash
cd apps/server && bun run backup && ls -la backups/
```

Expected: a `paragon-*.db` file whose size is close to the working database.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/services/backup.ts apps/server/src/app.ts apps/server/scripts/backup.ts apps/server/package.json apps/server/test/backup.test.ts .gitignore
git commit -m "feat: consistent database backups with retention"
```

---

### Task 5: Export and backup on the dashboard

**Files:**
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/components/DataActions.tsx`
- Test: verified in the browser

**Interfaces:**
- Produces: a small footer with export links and a backup button.

Links rather than fetch calls: the browser downloads a file from an `<a href>` without any JavaScript, and the server already sets `content-disposition`.

- [ ] **Step 1: Build the component**

`apps/web/src/components/DataActions.tsx`:

```typescript
import { useState } from "react";

export function DataActions({ month }: { month: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function backup() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/backup", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { sizeBytes: number };
      setStatus(`Backed up ${Math.round(body.sizeBytes / 1024)} KB.`);
    } catch {
      setStatus("Backup failed. Is the server running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10 flex flex-wrap items-center gap-3 border-t border-ink-700 pt-6 text-sm">
      <span className="text-xs uppercase tracking-widest text-ink-300">Your data</span>

      {/* Plain links: the server sets content-disposition, so no JavaScript is needed. */}
      <a
        href={`/api/export.csv?month=${month}`}
        className="rounded border border-ink-700 px-3 py-1.5 text-ink-300 hover:bg-ink-800 hover:text-ink-100"
      >
        This month as CSV
      </a>
      <a
        href="/api/export.json"
        className="rounded border border-ink-700 px-3 py-1.5 text-ink-300 hover:bg-ink-800 hover:text-ink-100"
      >
        Everything as JSON
      </a>

      <button
        type="button"
        onClick={backup}
        disabled={busy}
        className="rounded border border-ink-700 px-3 py-1.5 text-ink-300 hover:bg-ink-800 hover:text-ink-100 disabled:opacity-50"
      >
        {busy ? "Backing up…" : "Back up now"}
      </button>

      {status && <span className="text-xs text-ink-300">{status}</span>}
    </section>
  );
}
```

- [ ] **Step 2: Add it to the dashboard**

In `apps/web/src/App.tsx`, import it and render it at the end of the dashboard branch, after `TransactionList`:

```typescript
          <DataActions month={month} />
```

- [ ] **Step 3: Verify in the browser**

- the CSV link downloads a file that opens in a spreadsheet with readable dates, merchants and decimal amounts
- the JSON link downloads the full history
- "Back up now" reports a size, and the file appears in `apps/server/backups/`

- [ ] **Step 4: Typecheck and build**

Run: `cd apps/web && bun run build`
Expected: tsc passes, Vite builds.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat: export links and backup button"
```

---

## Definition of Done

- `bun test` passes: 206 tests.
- `bunx tsc --noEmit` exits 0 in both apps; `apps/web` builds.
- Six MCP tools are registered, and `get_summary` answers "how was August compared to July" in prose.
- The CSV opens in a spreadsheet with one row per line item and decimal amounts.
- A backup taken immediately after a write contains that write — proved by opening the backup file, not by checking that it exists.
- `pruneBackups` refuses to keep zero.
- No HTTP route or MCP tool imports `db`.

## The spec is complete after this

Everything in the spec's order of work is then built. What remains is explicitly "driven by actual use": plan versus actual (needs three months of history), the fixed/discretionary split, and the anomaly feed. None should be started before the data exists to justify them.
