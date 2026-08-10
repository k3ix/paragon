# Paragon UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the savings-rate dashboard with one that answers "how much can I move to savings on payday?", and show spending as a drillable category tree instead of a four-slice donut.

**Architecture:** A new `commitments` table holds declared monthly amounts (base income, rent, utilities) with month-string validity ranges. A `budget` service derives the set-aside figure from base income minus commitments minus a three-month average of flexible spending, returning nulls with a reason when history is too short. The dashboard is rebuilt around that figure; the donut and the income/spending line chart are deleted.

**Tech Stack:** Bun 1.3, Elysia 1.4 + Eden Treaty, Drizzle ORM + `bun:sqlite`, React 19 + Vite + Tailwind v4 + TanStack Query, `bun:test`, Playwright for screenshots.

## Global Constraints

- **All user-facing interface copy is Russian.** Two people read this screen. Code, comments, commit messages, and this plan stay English.
- **Money is integers in minor units** (grosze). Never floats. Format via `formatMinor` from `@paragon/shared`.
- **Months are `YYYY-MM` strings.** Parse via `parseMonth` from `apps/server/src/services/month.ts`, which rejects `2026-13`. Never `new Date(...)` on a month string.
- **Dates are Unix seconds** in `transactions.occurredOn`.
- **`onError` in `apps/server/src/app.ts` sets a status without returning a body.** Do not add a body — it widens every route's response type and breaks the typed frontend.
- **Elysia's `app.handle()` needs a real hostname in tests:** `new Request("http://localhost/api/...")`. A bare `http://x/` returns 404 for every route.
- **Currency is PLN only.** Salary arrives in zloty. Do not add conversion.
- **Tests run from the repo root** with `bun test`. Server tests live in `apps/server/tests/`.

---

### Task 1: Commitments table and migration

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Create: `apps/server/drizzle/0001_commitments.sql` (generated)
- Test: `apps/server/tests/commitments.test.ts`

**Interfaces:**
- Consumes: `categories` table from `apps/server/src/db/schema.ts`
- Produces: `commitments` Drizzle table with columns `id`, `kind`, `name`, `amountMinor`, `categoryId`, `activeFrom`, `activeTo`

- [ ] **Step 1: Add the table to the schema**

Append to `apps/server/src/db/schema.ts`:

```typescript
/**
 * Amounts declared in advance rather than discovered from transactions: the base
 * salary, rent, utilities. Rent is known before it is paid, so it cannot be derived
 * from history — and the payday figure is worthless without it.
 */
export const commitments = sqliteTable(
  "commitments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // "income" for the base salary, "expense" for rent and the like.
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    // Links an expense commitment to the tree so its category is not double-counted
    // in the flexible-spending average. NULL for income.
    categoryId: integer("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    // "YYYY-MM" month strings, not Unix seconds: a commitment applies to a whole
    // month, and storing an instant would force every read to decide which month a
    // timestamp falls in.
    activeFrom: text("active_from").notNull(),
    // Inclusive. NULL means "still current".
    activeTo: text("active_to"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => [index("commitments_active_from_idx").on(t.activeFrom)],
);
```

- [ ] **Step 2: Generate the migration**

```bash
cd apps/server && bun run db:generate
```

Expected: a new file under `apps/server/drizzle/` containing `CREATE TABLE \`commitments\``.

- [ ] **Step 3: Write the failing test**

Create `apps/server/tests/commitments.test.ts`:

```typescript
import { test, expect } from "bun:test";
import { db } from "../src/db";
import { commitments } from "../src/db/schema";

test("a commitment round-trips through the table", () => {
  const inserted = db
    .insert(commitments)
    .values({
      kind: "expense",
      name: "Аренда",
      amountMinor: 400000,
      activeFrom: "2026-08",
    })
    .returning()
    .get();

  expect(inserted.amountMinor).toBe(400000);
  expect(inserted.activeTo).toBeNull();

  db.delete(commitments).where(eq(commitments.id, inserted.id)).run();
});
```

Add `import { eq } from "drizzle-orm";` at the top.

- [ ] **Step 4: Run it and watch it fail**

```bash
bun test apps/server/tests/commitments.test.ts
```

Expected: FAIL — `no such table: commitments`.

- [ ] **Step 5: Apply the migration**

```bash
cd apps/server && bun run db:migrate
```

- [ ] **Step 6: Run the test again**

```bash
bun test apps/server/tests/commitments.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/drizzle apps/server/tests/commitments.test.ts
git commit -m "feat: commitments table for declared monthly amounts"
```

---

### Task 2: Commitments service

**Files:**
- Create: `apps/server/src/services/commitments.ts`
- Test: `apps/server/tests/commitments-service.test.ts`

**Interfaces:**
- Consumes: `commitments` table (Task 1), `parseMonth` from `./month`
- Produces:
  - `listCommitments(): Commitment[]`
  - `createCommitment(input: CommitmentInput): Commitment`
  - `updateCommitment(id: number, patch: Partial<CommitmentInput>): Commitment`
  - `endCommitment(id: number, lastMonth: string): Commitment`
  - `commitmentsForMonth(month: string): Commitment[]`
  - type `Commitment = { id: number; kind: "income" | "expense"; name: string; amountMinor: number; categoryId: number | null; activeFrom: string; activeTo: string | null }`
  - type `CommitmentInput = { kind: "income" | "expense"; name: string; amountMinor: number; categoryId?: number | null; activeFrom: string; activeTo?: string | null }`

- [ ] **Step 1: Write the failing tests**

Create `apps/server/tests/commitments-service.test.ts`:

```typescript
import { test, expect, afterEach } from "bun:test";
import { db } from "../src/db";
import { commitments } from "../src/db/schema";
import {
  createCommitment,
  listCommitments,
  endCommitment,
  commitmentsForMonth,
} from "../src/services/commitments";

afterEach(() => {
  db.delete(commitments).run();
});

test("a commitment applies from its start month onward", () => {
  createCommitment({
    kind: "expense",
    name: "Аренда",
    amountMinor: 400000,
    activeFrom: "2026-08",
  });

  expect(commitmentsForMonth("2026-07")).toHaveLength(0);
  expect(commitmentsForMonth("2026-08")).toHaveLength(1);
  expect(commitmentsForMonth("2026-12")).toHaveLength(1);
});

test("ending a commitment stops it after the given month", () => {
  const rent = createCommitment({
    kind: "expense",
    name: "Аренда",
    amountMinor: 400000,
    activeFrom: "2026-01",
  });
  endCommitment(rent.id, "2026-06");

  expect(commitmentsForMonth("2026-06")).toHaveLength(1);
  expect(commitmentsForMonth("2026-07")).toHaveLength(0);
});

test("a raise is two rows, so past months keep the old amount", () => {
  const old = createCommitment({
    kind: "expense",
    name: "Аренда",
    amountMinor: 400000,
    activeFrom: "2026-01",
  });
  endCommitment(old.id, "2026-06");
  createCommitment({
    kind: "expense",
    name: "Аренда",
    amountMinor: 450000,
    activeFrom: "2026-07",
  });

  expect(commitmentsForMonth("2026-05")[0]!.amountMinor).toBe(400000);
  expect(commitmentsForMonth("2026-08")[0]!.amountMinor).toBe(450000);
});

test("an invalid month is refused", () => {
  expect(() =>
    createCommitment({
      kind: "expense",
      name: "Аренда",
      amountMinor: 400000,
      activeFrom: "2026-13",
    }),
  ).toThrow(/Invalid month/);
});

test("a commitment ending before it starts is refused", () => {
  expect(() =>
    createCommitment({
      kind: "expense",
      name: "Аренда",
      amountMinor: 400000,
      activeFrom: "2026-08",
      activeTo: "2026-07",
    }),
  ).toThrow(/before it starts/);
});

test("listing returns every row regardless of validity", () => {
  const a = createCommitment({
    kind: "income",
    name: "Зарплата",
    amountMinor: 2800000,
    activeFrom: "2026-01",
  });
  endCommitment(a.id, "2026-03");
  createCommitment({
    kind: "expense",
    name: "Аренда",
    amountMinor: 400000,
    activeFrom: "2026-08",
  });

  expect(listCommitments()).toHaveLength(2);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
bun test apps/server/tests/commitments-service.test.ts
```

Expected: FAIL — cannot resolve `../src/services/commitments`.

- [ ] **Step 3: Write the service**

Create `apps/server/src/services/commitments.ts`:

```typescript
import { eq } from "drizzle-orm";
import { db } from "../db";
import { commitments } from "../db/schema";
import { parseMonth } from "./month";

export type Commitment = {
  id: number;
  kind: "income" | "expense";
  name: string;
  amountMinor: number;
  categoryId: number | null;
  activeFrom: string;
  activeTo: string | null;
};

export type CommitmentInput = {
  kind: "income" | "expense";
  name: string;
  amountMinor: number;
  categoryId?: number | null;
  activeFrom: string;
  activeTo?: string | null;
};

/** Rows come back with `kind` widened to string; this narrows it once, centrally. */
function toCommitment(row: typeof commitments.$inferSelect): Commitment {
  return {
    id: row.id,
    kind: row.kind === "income" ? "income" : "expense",
    name: row.name,
    amountMinor: row.amountMinor,
    categoryId: row.categoryId,
    activeFrom: row.activeFrom,
    activeTo: row.activeTo,
  };
}

/** Both months are validated, and an inverted range is rejected outright. */
function checkRange(activeFrom: string, activeTo?: string | null): void {
  parseMonth(activeFrom);
  if (activeTo != null) {
    parseMonth(activeTo);
    if (activeTo < activeFrom) {
      throw new Error(`A commitment cannot end before it starts: ${activeFrom} to ${activeTo}`);
    }
  }
}

export function listCommitments(): Commitment[] {
  return db.select().from(commitments).all().map(toCommitment);
}

export function createCommitment(input: CommitmentInput): Commitment {
  checkRange(input.activeFrom, input.activeTo);
  if (input.amountMinor <= 0) throw new Error("A commitment amount must be positive.");

  const row = db
    .insert(commitments)
    .values({
      kind: input.kind,
      name: input.name.trim(),
      amountMinor: input.amountMinor,
      categoryId: input.categoryId ?? null,
      activeFrom: input.activeFrom,
      activeTo: input.activeTo ?? null,
    })
    .returning()
    .get();
  return toCommitment(row);
}

export function updateCommitment(id: number, patch: Partial<CommitmentInput>): Commitment {
  const current = db.select().from(commitments).where(eq(commitments.id, id)).get();
  if (!current) throw new Error(`Commitment not found: ${id}`);

  const activeFrom = patch.activeFrom ?? current.activeFrom;
  const activeTo = patch.activeTo === undefined ? current.activeTo : patch.activeTo;
  checkRange(activeFrom, activeTo);
  if (patch.amountMinor !== undefined && patch.amountMinor <= 0) {
    throw new Error("A commitment amount must be positive.");
  }

  const row = db
    .update(commitments)
    .set({
      ...(patch.kind !== undefined && { kind: patch.kind }),
      ...(patch.name !== undefined && { name: patch.name.trim() }),
      ...(patch.amountMinor !== undefined && { amountMinor: patch.amountMinor }),
      ...(patch.categoryId !== undefined && { categoryId: patch.categoryId }),
      activeFrom,
      activeTo,
    })
    .where(eq(commitments.id, id))
    .returning()
    .get();
  return toCommitment(row);
}

/**
 * Closes a commitment at the end of `lastMonth` instead of deleting it, so past
 * months keep the amount that actually applied to them.
 */
export function endCommitment(id: number, lastMonth: string): Commitment {
  return updateCommitment(id, { activeTo: lastMonth });
}

/**
 * The commitments in force during a month.
 *
 * "YYYY-MM" compares correctly as a string — the fixed width and zero padding make
 * lexical order match chronological order — so no date parsing is needed here.
 */
export function commitmentsForMonth(month: string): Commitment[] {
  parseMonth(month);
  return listCommitments().filter(
    (c) => c.activeFrom <= month && (c.activeTo === null || month <= c.activeTo),
  );
}
```

- [ ] **Step 4: Run the tests**

```bash
bun test apps/server/tests/commitments-service.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/commitments.ts apps/server/tests/commitments-service.test.ts
git commit -m "feat: commitments service with month-range validity"
```

---

### Task 3: Budget calculation

**Files:**
- Create: `apps/server/src/services/budget.ts`
- Test: `apps/server/tests/budget.test.ts`

**Interfaces:**
- Consumes: `commitmentsForMonth` (Task 2), `monthBounds` / `shiftMonth` / `parseMonth` from `./month`, `transactions` + `lineItems` + `categories` tables
- Produces:
  - `getBudget(month: string): Budget`
  - type `Budget` as defined in Step 3

**Key rules this task encodes:**
- The set-aside figure is computed from **base income** (a declared commitment), never from actual salary rows — overtime must not inflate it.
- The flexible average uses **completed months only**; the current month is partial and would bias it downward.
- Fewer than **three** completed months means no average, and the response says how many are still missing.
- Spending in a category covered by an expense commitment is **excluded** from the flexible average, or rent would be counted twice.

- [ ] **Step 1: Write the failing tests**

Create `apps/server/tests/budget.test.ts`:

```typescript
import { test, expect, afterEach } from "bun:test";
import { db } from "../src/db";
import { commitments, transactions, lineItems, categories } from "../src/db/schema";
import { createCommitment } from "../src/services/commitments";
import { getBudget } from "../src/services/budget";

function seedCategory(name: string): number {
  return db.insert(categories).values({ name }).returning().get().id;
}

/** One expense of `amount` grosze in `month`, filed under `categoryId`. */
function seedSpend(month: string, amount: number, categoryId: number, tag: string): void {
  const [year, m] = month.split("-").map(Number);
  const occurredOn = Math.floor(Date.UTC(year!, m! - 1, 15) / 1000);
  const tx = db
    .insert(transactions)
    .values({
      occurredOn,
      type: "expense",
      totalMinor: amount,
      dedupHash: `budget-test-${tag}`,
    })
    .returning()
    .get();
  db.insert(lineItems).values({ transactionId: tx.id, amountMinor: amount, categoryId }).run();
}

afterEach(() => {
  db.delete(lineItems).run();
  db.delete(transactions).run();
  db.delete(commitments).run();
  db.delete(categories).run();
});

test("with no base income the set-aside figure is unknown", () => {
  const budget = getBudget("2026-08");
  expect(budget.baseIncomeMinor).toBeNull();
  expect(budget.setAsideMinor).toBeNull();
  expect(budget.reason).toBe("no-base-income");
});

test("with fewer than three completed months the average is unknown", () => {
  createCommitment({
    kind: "income",
    name: "Зарплата",
    amountMinor: 2800000,
    activeFrom: "2026-01",
  });
  const food = seedCategory("Еда");
  seedSpend("2026-07", 100000, food, "a");
  seedSpend("2026-08", 100000, food, "b");

  const budget = getBudget("2026-08");
  expect(budget.baseIncomeMinor).toBe(2800000);
  expect(budget.flexibleAverageMinor).toBeNull();
  expect(budget.setAsideMinor).toBeNull();
  expect(budget.reason).toBe("not-enough-history");
  // 2026-07 is the only completed month with data, so two more are needed.
  expect(budget.monthsNeeded).toBe(2);
});

test("three completed months give a set-aside figure", () => {
  createCommitment({
    kind: "income",
    name: "Зарплата",
    amountMinor: 2800000,
    activeFrom: "2026-01",
  });
  createCommitment({
    kind: "expense",
    name: "Аренда",
    amountMinor: 400000,
    activeFrom: "2026-01",
  });
  const food = seedCategory("Еда");
  seedSpend("2026-05", 90000, food, "a");
  seedSpend("2026-06", 110000, food, "b");
  seedSpend("2026-07", 100000, food, "c");

  const budget = getBudget("2026-08");
  expect(budget.committedMinor).toBe(400000);
  expect(budget.flexibleAverageMinor).toBe(100000);
  // 2 800 000 − 400 000 − 100 000
  expect(budget.setAsideMinor).toBe(2300000);
  expect(budget.reason).toBeNull();
});

test("the current month never enters the average", () => {
  createCommitment({
    kind: "income",
    name: "Зарплата",
    amountMinor: 2800000,
    activeFrom: "2026-01",
  });
  const food = seedCategory("Еда");
  seedSpend("2026-05", 100000, food, "a");
  seedSpend("2026-06", 100000, food, "b");
  seedSpend("2026-07", 100000, food, "c");
  // A partial current month, far below the others.
  seedSpend("2026-08", 1000, food, "d");

  expect(getBudget("2026-08").flexibleAverageMinor).toBe(100000);
});

test("spending in a committed category is not averaged twice", () => {
  createCommitment({
    kind: "income",
    name: "Зарплата",
    amountMinor: 2800000,
    activeFrom: "2026-01",
  });
  const rentCategory = seedCategory("Аренда");
  const food = seedCategory("Еда");
  createCommitment({
    kind: "expense",
    name: "Аренда",
    amountMinor: 400000,
    categoryId: rentCategory,
    activeFrom: "2026-01",
  });

  for (const [month, tag] of [
    ["2026-05", "a"],
    ["2026-06", "b"],
    ["2026-07", "c"],
  ] as const) {
    seedSpend(month, 100000, food, tag);
    seedSpend(month, 400000, rentCategory, `${tag}-rent`);
  }

  const budget = getBudget("2026-08");
  // Rent is committed, so only the food spending is averaged.
  expect(budget.flexibleAverageMinor).toBe(100000);
  expect(budget.setAsideMinor).toBe(2300000);
});

test("an invalid month is refused", () => {
  expect(() => getBudget("2026-13")).toThrow(/Invalid month/);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
bun test apps/server/tests/budget.test.ts
```

Expected: FAIL — cannot resolve `../src/services/budget`.

- [ ] **Step 3: Write the service**

Create `apps/server/src/services/budget.ts`:

```typescript
import { and, gte, lt, eq, sql, inArray, isNull, or } from "drizzle-orm";
import { db } from "../db";
import { transactions, lineItems } from "../db/schema";
import { commitmentsForMonth } from "./commitments";
import { monthBounds, shiftMonth, parseMonth } from "./month";

/** Completed months required before an average of flexible spending means anything. */
const MONTHS_REQUIRED = 3;

export type Budget = {
  month: string;
  /** The declared recurring salary, not what actually landed. Null when undeclared. */
  baseIncomeMinor: number | null;
  /** Declared recurring expenses in force this month. */
  committedMinor: number;
  /** Average of completed months' flexible spending. Null until enough history. */
  flexibleAverageMinor: number | null;
  /** base − committed − flexible average. Null when either input is missing. */
  setAsideMinor: number | null;
  /** Why setAsideMinor is null, for the screen to explain itself. */
  reason: "no-base-income" | "not-enough-history" | null;
  /** Completed months still needed before an average exists. */
  monthsNeeded: number;
  /** Completed months that had any spending at all. */
  monthsObserved: number;
};

/** Total expense line amounts in a month, optionally excluding some categories. */
function flexibleSpendInMonth(month: string, excludedCategoryIds: number[]): number {
  const { start, end } = monthBounds(month);
  const row = db
    .select({ total: sql<number | null>`sum(${lineItems.amountMinor})` })
    .from(lineItems)
    .innerJoin(transactions, eq(transactions.id, lineItems.transactionId))
    .where(
      and(
        eq(transactions.type, "expense"),
        gte(transactions.occurredOn, start),
        lt(transactions.occurredOn, end),
        // An uncategorized line has no category to exclude, so it always counts.
        excludedCategoryIds.length > 0
          ? or(
              isNull(lineItems.categoryId),
              sql`${lineItems.categoryId} not in ${excludedCategoryIds}`,
            )
          : undefined,
      ),
    )
    .get();
  return row?.total ?? 0;
}

/**
 * The payday figure.
 *
 * Anchored to declared base income rather than actual salary rows: overtime and
 * on-call vary month to month, and a figure that rises with them teaches spending
 * habits a weak month cannot pay for. Surplus above base is saved whole and never
 * enters this calculation.
 */
export function getBudget(month: string): Budget {
  parseMonth(month);

  const active = commitmentsForMonth(month);
  const baseIncomeMinor =
    active
      .filter((c) => c.kind === "income")
      .reduce((sum, c) => sum + c.amountMinor, 0) || null;

  const expenseCommitments = active.filter((c) => c.kind === "expense");
  const committedMinor = expenseCommitments.reduce((sum, c) => sum + c.amountMinor, 0);

  // A category already covered by a commitment would otherwise be counted twice:
  // once as committed, once inside the flexible average.
  const excluded = expenseCommitments
    .map((c) => c.categoryId)
    .filter((id): id is number => id !== null);

  // Completed months only. The current month is partial, and averaging it against
  // whole months drags the figure below what a month actually costs.
  const observed: number[] = [];
  for (let i = 1; i <= 12; i++) {
    const past = shiftMonth(month, -i);
    const spend = flexibleSpendInMonth(past, excluded);
    if (spend > 0) observed.push(spend);
  }

  const monthsObserved = observed.length;
  const monthsNeeded = Math.max(MONTHS_REQUIRED - monthsObserved, 0);

  const recent = observed.slice(0, MONTHS_REQUIRED);
  const flexibleAverageMinor =
    recent.length >= MONTHS_REQUIRED
      ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length)
      : null;

  const reason =
    baseIncomeMinor === null
      ? ("no-base-income" as const)
      : flexibleAverageMinor === null
        ? ("not-enough-history" as const)
        : null;

  return {
    month,
    baseIncomeMinor,
    committedMinor,
    flexibleAverageMinor,
    setAsideMinor:
      baseIncomeMinor !== null && flexibleAverageMinor !== null
        ? baseIncomeMinor - committedMinor - flexibleAverageMinor
        : null,
    reason,
    monthsNeeded,
    monthsObserved,
  };
}
```

- [ ] **Step 4: Run the tests**

```bash
bun test apps/server/tests/budget.test.ts
```

Expected: PASS, 6 tests. If the `not in` clause fails to compile, replace the `or(...)` with `sql\`(${lineItems.categoryId} is null or ${lineItems.categoryId} not in (${sql.join(excludedCategoryIds, sql\`, \`)}))\`` and rerun.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/budget.ts apps/server/tests/budget.test.ts
git commit -m "feat: payday set-aside calculation from base income and history"
```

---

### Task 4: Month pace

**Files:**
- Create: `apps/server/src/services/pace.ts`
- Test: `apps/server/tests/pace.test.ts`

**Interfaces:**
- Consumes: `monthBounds` / `parseMonth` from `./month`, `getBudget` (Task 3)
- Produces: `getPace(month: string, today?: number): Pace`

- [ ] **Step 1: Write the failing tests**

Create `apps/server/tests/pace.test.ts`:

```typescript
import { test, expect, afterEach } from "bun:test";
import { db } from "../src/db";
import { transactions, lineItems, categories, commitments } from "../src/db/schema";
import { getPace } from "../src/services/pace";

function seedSpend(day: number, amount: number, tag: string): void {
  const occurredOn = Math.floor(Date.UTC(2026, 7, day) / 1000);
  const tx = db
    .insert(transactions)
    .values({ occurredOn, type: "expense", totalMinor: amount, dedupHash: `pace-${tag}` })
    .returning()
    .get();
  db.insert(lineItems).values({ transactionId: tx.id, amountMinor: amount }).run();
}

afterEach(() => {
  db.delete(lineItems).run();
  db.delete(transactions).run();
  db.delete(commitments).run();
  db.delete(categories).run();
});

test("pace divides spending by days elapsed, not days in the month", () => {
  seedSpend(1, 30000, "a");
  seedSpend(5, 30000, "b");

  // Ninth of August: nine days elapsed, 600.00 spent.
  const today = Math.floor(Date.UTC(2026, 7, 9) / 1000);
  const pace = getPace("2026-08", today);

  expect(pace.spentMinor).toBe(60000);
  expect(pace.daysElapsed).toBe(9);
  expect(pace.daysRemaining).toBe(22);
  expect(pace.perDayMinor).toBe(6667);
});

test("a past month counts every one of its days", () => {
  const today = Math.floor(Date.UTC(2026, 8, 15) / 1000);
  const pace = getPace("2026-08", today);

  expect(pace.daysElapsed).toBe(31);
  expect(pace.daysRemaining).toBe(0);
});

test("a future month has no elapsed days and no pace", () => {
  const today = Math.floor(Date.UTC(2026, 6, 15) / 1000);
  const pace = getPace("2026-08", today);

  expect(pace.daysElapsed).toBe(0);
  expect(pace.perDayMinor).toBeNull();
});

test("projection extrapolates the current pace across the month", () => {
  seedSpend(1, 100000, "a");

  const today = Math.floor(Date.UTC(2026, 7, 10) / 1000);
  const pace = getPace("2026-08", today);

  // 1000.00 over 10 days -> 100.00/day -> 3100.00 across 31 days.
  expect(pace.projectedMinor).toBe(310000);
});

test("an invalid month is refused", () => {
  expect(() => getPace("2026-13")).toThrow(/Invalid month/);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
bun test apps/server/tests/pace.test.ts
```

Expected: FAIL — cannot resolve `../src/services/pace`.

- [ ] **Step 3: Write the service**

Create `apps/server/src/services/pace.ts`:

```typescript
import { and, gte, lt, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { transactions } from "../db/schema";
import { monthBounds, parseMonth } from "./month";
import { getBudget } from "./budget";

const DAY = 86400;

export type Pace = {
  month: string;
  spentMinor: number;
  daysElapsed: number;
  daysInMonth: number;
  daysRemaining: number;
  /** Average spend per elapsed day. Null before the month begins. */
  perDayMinor: number | null;
  /** Current pace extended across the whole month. Null before it begins. */
  projectedMinor: number | null;
  /** The flexible-spending budget this month is measured against, when known. */
  budgetMinor: number | null;
};

/**
 * How the month is going so far.
 *
 * `today` is a parameter rather than a call to the clock so the behaviour is
 * testable — every branch here depends on where "now" falls relative to the month.
 */
export function getPace(month: string, today: number = Math.floor(Date.now() / 1000)): Pace {
  parseMonth(month);
  const { start, end } = monthBounds(month);
  const daysInMonth = Math.round((end - start) / DAY);

  const row = db
    .select({ total: sql<number | null>`sum(${transactions.totalMinor})` })
    .from(transactions)
    .where(
      and(
        eq(transactions.type, "expense"),
        gte(transactions.occurredOn, start),
        lt(transactions.occurredOn, end),
      ),
    )
    .get();
  const spentMinor = row?.total ?? 0;

  // Before the month: nothing elapsed. After it: all of it. Inside: whole days so far,
  // counting the current day as elapsed.
  const daysElapsed =
    today < start
      ? 0
      : today >= end
        ? daysInMonth
        : Math.min(Math.floor((today - start) / DAY) + 1, daysInMonth);

  const perDayMinor = daysElapsed > 0 ? Math.round(spentMinor / daysElapsed) : null;

  return {
    month,
    spentMinor,
    daysElapsed,
    daysInMonth,
    daysRemaining: daysInMonth - daysElapsed,
    perDayMinor,
    projectedMinor: perDayMinor === null ? null : perDayMinor * daysInMonth,
    budgetMinor: getBudget(month).flexibleAverageMinor,
  };
}
```

- [ ] **Step 4: Run the tests**

```bash
bun test apps/server/tests/pace.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/pace.ts apps/server/tests/pace.test.ts
git commit -m "feat: month pace with projection"
```

---

### Task 5: Category tree breakdown with month-over-month deltas

**Files:**
- Modify: `apps/server/src/services/summary.ts`
- Modify: `packages/shared/src/schemas/summary.ts`
- Test: `apps/server/tests/tree-breakdown.test.ts`

**Interfaces:**
- Consumes: `categories` / `lineItems` / `transactions` tables, `monthBounds` / `shiftMonth`
- Produces:
  - `getCategoryTreeBreakdown(month: string): CategoryTreeNode[]`
  - type `CategoryTreeNode = { categoryId: number | null; name: string; totalMinor: number; share: number; previousMinor: number; deltaMinor: number; children: CategoryTreeNode[] }`

The existing `getCategoryBreakdown` stays — the export routes still use it. This adds a second function rather than changing the first.

- [ ] **Step 1: Add the shared type**

Append to `packages/shared/src/schemas/summary.ts`:

```typescript
/**
 * Spending for a month as a tree, so a parent's total and its children's split are
 * visible at once. A flat rollup hides exactly the breakdown that was entered by hand.
 */
export type CategoryTreeNode = {
  categoryId: number | null;
  name: string;
  /** Full path, e.g. "Еда/Продукты". Used to filter purchases by branch. */
  path: string;
  totalMinor: number;
  /** Percentage of the month's total spending, rounded. */
  share: number;
  previousMinor: number;
  /** totalMinor − previousMinor. Positive means this month cost more. */
  deltaMinor: number;
  children: CategoryTreeNode[];
};
```

- [ ] **Step 2: Write the failing tests**

Create `apps/server/tests/tree-breakdown.test.ts`:

```typescript
import { test, expect, afterEach } from "bun:test";
import { db } from "../src/db";
import { transactions, lineItems, categories } from "../src/db/schema";
import { getCategoryTreeBreakdown } from "../src/services/summary";

function seedCategory(name: string, parentId: number | null = null): number {
  return db.insert(categories).values({ name, parentId }).returning().get().id;
}

function seedSpend(month: string, amount: number, categoryId: number | null, tag: string): void {
  const [year, m] = month.split("-").map(Number);
  const occurredOn = Math.floor(Date.UTC(year!, m! - 1, 15) / 1000);
  const tx = db
    .insert(transactions)
    .values({ occurredOn, type: "expense", totalMinor: amount, dedupHash: `tree-${tag}` })
    .returning()
    .get();
  db.insert(lineItems).values({ transactionId: tx.id, amountMinor: amount, categoryId }).run();
}

afterEach(() => {
  db.delete(lineItems).run();
  db.delete(transactions).run();
  db.delete(categories).run();
});

test("children roll up into their parent's total", () => {
  const food = seedCategory("Еда");
  const groceries = seedCategory("Продукты", food);
  const alcohol = seedCategory("Алкоголь", food);
  seedSpend("2026-08", 40000, groceries, "a");
  seedSpend("2026-08", 10000, alcohol, "b");

  const tree = getCategoryTreeBreakdown("2026-08");
  const foodNode = tree.find((n) => n.name === "Еда")!;

  expect(foodNode.totalMinor).toBe(50000);
  expect(foodNode.children).toHaveLength(2);
  expect(foodNode.children.find((c) => c.name === "Алкоголь")!.totalMinor).toBe(10000);
});

test("a parent keeps spending filed directly against it", () => {
  const food = seedCategory("Еда");
  const groceries = seedCategory("Продукты", food);
  seedSpend("2026-08", 30000, food, "a");
  seedSpend("2026-08", 20000, groceries, "b");

  const foodNode = getCategoryTreeBreakdown("2026-08").find((n) => n.name === "Еда")!;
  expect(foodNode.totalMinor).toBe(50000);
});

test("the delta compares against the previous month", () => {
  const food = seedCategory("Еда");
  seedSpend("2026-07", 30000, food, "a");
  seedSpend("2026-08", 50000, food, "b");

  const foodNode = getCategoryTreeBreakdown("2026-08").find((n) => n.name === "Еда")!;
  expect(foodNode.previousMinor).toBe(30000);
  expect(foodNode.deltaMinor).toBe(20000);
});

test("uncategorized spending appears as its own node", () => {
  seedSpend("2026-08", 12345, null, "a");

  const node = getCategoryTreeBreakdown("2026-08").find((n) => n.categoryId === null)!;
  expect(node.totalMinor).toBe(12345);
  // An empty path, so the purchase filter selects "no category" rather than a branch.
  expect(node.path).toBe("");
});

test("a child's path names its whole branch", () => {
  const food = seedCategory("Еда");
  const groceries = seedCategory("Продукты", food);
  seedSpend("2026-08", 10000, groceries, "a");

  const foodNode = getCategoryTreeBreakdown("2026-08").find((n) => n.name === "Еда")!;
  expect(foodNode.path).toBe("Еда");
  expect(foodNode.children[0]!.path).toBe("Еда/Продукты");
});

test("nodes are sorted by spending, biggest first", () => {
  const food = seedCategory("Еда");
  const transport = seedCategory("Транспорт");
  seedSpend("2026-08", 10000, transport, "a");
  seedSpend("2026-08", 90000, food, "b");

  const tree = getCategoryTreeBreakdown("2026-08");
  expect(tree[0]!.name).toBe("Еда");
});

test("a category with no spending in either month is omitted", () => {
  const food = seedCategory("Еда");
  seedCategory("Подарки");
  seedSpend("2026-08", 10000, food, "a");

  const tree = getCategoryTreeBreakdown("2026-08");
  expect(tree.find((n) => n.name === "Подарки")).toBeUndefined();
});

test("shares are percentages of the month total", () => {
  const food = seedCategory("Еда");
  const transport = seedCategory("Транспорт");
  seedSpend("2026-08", 75000, food, "a");
  seedSpend("2026-08", 25000, transport, "b");

  const tree = getCategoryTreeBreakdown("2026-08");
  expect(tree.find((n) => n.name === "Еда")!.share).toBe(75);
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
bun test apps/server/tests/tree-breakdown.test.ts
```

Expected: FAIL — `getCategoryTreeBreakdown` is not exported.

- [ ] **Step 4: Implement it**

Append to `apps/server/src/services/summary.ts` (and add `CategoryTreeNode` to the existing `import type` and `export type` lines at the top):

```typescript
/** Spending per category id for one month, without any rollup. */
function directSpendByCategory(month: string): Map<number | null, number> {
  const { start, end } = monthBounds(month);
  const rows = db
    .select({
      categoryId: lineItems.categoryId,
      total: sql<number>`sum(${lineItems.amountMinor})`,
    })
    .from(lineItems)
    .innerJoin(transactions, eq(transactions.id, lineItems.transactionId))
    .where(
      and(
        eq(transactions.type, "expense"),
        gte(transactions.occurredOn, start),
        lt(transactions.occurredOn, end),
      ),
    )
    .groupBy(lineItems.categoryId)
    .all();

  return new Map(rows.map((r) => [r.categoryId, r.total]));
}

/**
 * Spending as a tree: every category with its children beneath it, each carrying its
 * own subtotal plus everything filed under its descendants.
 *
 * Replaces the flat rollup on the dashboard. A parent-only view hides the split
 * between, say, groceries and alcohol — which is the split worth seeing.
 */
export function getCategoryTreeBreakdown(month: string): CategoryTreeNode[] {
  const current = directSpendByCategory(month);
  const previous = directSpendByCategory(shiftMonth(month, -1));

  const all = db
    .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
    .from(categories)
    .all();

  const childrenOf = new Map<number | null, typeof all>();
  for (const row of all) {
    const siblings = childrenOf.get(row.parentId) ?? [];
    siblings.push(row);
    childrenOf.set(row.parentId, siblings);
  }

  const monthTotal = [...current.values()].reduce((a, b) => a + b, 0);

  /** Builds a node and its subtree, returning null when nothing was spent anywhere in it. */
  function build(row: { id: number; name: string }, prefix = ""): CategoryTreeNode | null {
    const path = prefix ? `${prefix}/${row.name}` : row.name;
    const children = (childrenOf.get(row.id) ?? [])
      .map((child) => build(child, path))
      .filter((n): n is CategoryTreeNode => n !== null)
      .sort((a, b) => b.totalMinor - a.totalMinor);

    const totalMinor =
      (current.get(row.id) ?? 0) + children.reduce((sum, c) => sum + c.totalMinor, 0);
    const previousMinor =
      (previous.get(row.id) ?? 0) + children.reduce((sum, c) => sum + c.previousMinor, 0);

    if (totalMinor === 0 && previousMinor === 0) return null;

    return {
      categoryId: row.id,
      name: row.name,
      path,
      totalMinor,
      share: monthTotal === 0 ? 0 : Math.round((totalMinor / monthTotal) * 100),
      previousMinor,
      deltaMinor: totalMinor - previousMinor,
      children,
    };
  }

  const roots = (childrenOf.get(null) ?? [])
    .map((row) => build(row))
    .filter((n): n is CategoryTreeNode => n !== null);

  // Lines with no category belong to no branch, but hiding them would make the tree
  // disagree with the month total.
  const uncategorized = current.get(null) ?? 0;
  const uncategorizedPrevious = previous.get(null) ?? 0;
  if (uncategorized > 0 || uncategorizedPrevious > 0) {
    roots.push({
      categoryId: null,
      name: "Без категории",
      path: "",
      totalMinor: uncategorized,
      share: monthTotal === 0 ? 0 : Math.round((uncategorized / monthTotal) * 100),
      previousMinor: uncategorizedPrevious,
      deltaMinor: uncategorized - uncategorizedPrevious,
      children: [],
    });
  }

  return roots.sort((a, b) => b.totalMinor - a.totalMinor);
}
```

- [ ] **Step 5: Run the tests**

```bash
bun test apps/server/tests/tree-breakdown.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 6: Run the whole suite to check nothing regressed**

```bash
bun test
```

Expected: PASS, all tests.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/services/summary.ts packages/shared/src/schemas/summary.ts apps/server/tests/tree-breakdown.test.ts
git commit -m "feat: category tree breakdown with month-over-month deltas"
```

---

### Task 6: HTTP routes

**Files:**
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/tests/routes-budget.test.ts`

**Interfaces:**
- Consumes: `getBudget` (Task 3), `getPace` (Task 4), `getCategoryTreeBreakdown` (Task 5), commitments service (Task 2)
- Produces: `GET /api/budget`, `GET /api/pace`, `GET /api/tree`, `GET|POST|PATCH|DELETE /api/commitments`

- [ ] **Step 1: Write the failing tests**

Create `apps/server/tests/routes-budget.test.ts`:

```typescript
import { test, expect, afterEach } from "bun:test";
import { db } from "../src/db";
import { commitments } from "../src/db/schema";
import { app } from "../src/app";

// A real hostname is required: Elysia routes 404 on a bare "http://x/" URL.
const base = "http://localhost";

afterEach(() => {
  db.delete(commitments).run();
});

test("GET /api/budget answers for a month", async () => {
  const res = await app.handle(new Request(`${base}/api/budget?month=2026-08`));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.month).toBe("2026-08");
  expect(body).toHaveProperty("setAsideMinor");
});

test("GET /api/budget rejects a bad month", async () => {
  const res = await app.handle(new Request(`${base}/api/budget?month=2026-13`));
  expect(res.status).toBe(422);
});

test("GET /api/pace answers for a month", async () => {
  const res = await app.handle(new Request(`${base}/api/pace?month=2026-08`));
  expect(res.status).toBe(200);
  expect(await res.json()).toHaveProperty("daysRemaining");
});

test("GET /api/tree returns an array", async () => {
  const res = await app.handle(new Request(`${base}/api/tree?month=2026-08`));
  expect(res.status).toBe(200);
  expect(Array.isArray(await res.json())).toBe(true);
});

test("a commitment can be created, listed, patched and ended", async () => {
  const created = await app.handle(
    new Request(`${base}/api/commitments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "expense",
        name: "Аренда",
        amountMinor: 400000,
        activeFrom: "2026-08",
      }),
    }),
  );
  expect(created.status).toBe(200);
  const commitment = await created.json();

  const listed = await app.handle(new Request(`${base}/api/commitments`));
  expect(await listed.json()).toHaveLength(1);

  const patched = await app.handle(
    new Request(`${base}/api/commitments/${commitment.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amountMinor: 450000 }),
    }),
  );
  expect((await patched.json()).amountMinor).toBe(450000);

  const ended = await app.handle(
    new Request(`${base}/api/commitments/${commitment.id}`, { method: "DELETE" }),
  );
  expect((await ended.json()).activeTo).not.toBeNull();
});

test("a commitment with a zero amount is refused", async () => {
  const res = await app.handle(
    new Request(`${base}/api/commitments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "expense",
        name: "Аренда",
        amountMinor: 0,
        activeFrom: "2026-08",
      }),
    }),
  );
  expect(res.status).toBe(422);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
bun test apps/server/tests/routes-budget.test.ts
```

Expected: FAIL — 404 on every new route.

- [ ] **Step 3: Widen the error matcher**

In `apps/server/src/app.ts`, add two clauses to the `if` chain inside `onError` so the new service errors map to 422 rather than 500:

```typescript
      /must be positive/i.test(message) ||
      /before it starts/i.test(message) ||
```

Place them immediately after the `/needs at least one filter/i` line.

- [ ] **Step 4: Add the routes**

Add to the imports at the top of `apps/server/src/app.ts`:

```typescript
import { getBudget } from "./services/budget";
import { getPace } from "./services/pace";
import { getCategoryTreeBreakdown } from "./services/summary";
import {
  listCommitments,
  createCommitment,
  updateCommitment,
  endCommitment,
} from "./services/commitments";
```

Add `getCategoryTreeBreakdown` to the existing `./services/summary` import instead of a second import line if one already exists.

Insert these routes after the existing `.get("/breakdown", ...)` route:

```typescript
  .get("/budget", ({ query }) => getBudget(query.month), { query: monthQuery })

  .get("/pace", ({ query }) => getPace(query.month), { query: monthQuery })

  .get("/tree", ({ query }) => getCategoryTreeBreakdown(query.month), { query: monthQuery })

  .get("/commitments", () => listCommitments())

  .post("/commitments", ({ body }) => createCommitment(body), {
    body: t.Object({
      kind: t.Union([t.Literal("income"), t.Literal("expense")]),
      name: t.String({ minLength: 1 }),
      amountMinor: t.Number(),
      categoryId: t.Optional(t.Union([t.Number(), t.Null()])),
      activeFrom: t.String({ pattern: monthPattern }),
      activeTo: t.Optional(t.Union([t.String({ pattern: monthPattern }), t.Null()])),
    }),
  })

  .patch("/commitments/:id", ({ params, body }) => updateCommitment(Number(params.id), body), {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      kind: t.Optional(t.Union([t.Literal("income"), t.Literal("expense")])),
      name: t.Optional(t.String({ minLength: 1 })),
      amountMinor: t.Optional(t.Number()),
      categoryId: t.Optional(t.Union([t.Number(), t.Null()])),
      activeFrom: t.Optional(t.String({ pattern: monthPattern })),
      activeTo: t.Optional(t.Union([t.String({ pattern: monthPattern }), t.Null()])),
    }),
  })

  // DELETE ends a commitment rather than removing it: past months must keep the
  // amount that actually applied to them. The month defaults to the current one so
  // the button in the UI needs no argument.
  .delete(
    "/commitments/:id",
    ({ params, query }) => {
      const now = new Date();
      const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      return endCommitment(Number(params.id), query.month ?? thisMonth);
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Object({ month: t.Optional(t.String({ pattern: monthPattern })) }),
    },
  )
```

- [ ] **Step 5: Run the tests**

```bash
bun test apps/server/tests/routes-budget.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Typecheck**

```bash
cd apps/server && bunx tsc --noEmit
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/app.ts apps/server/tests/routes-budget.test.ts
git commit -m "feat: budget, pace, tree and commitments routes"
```

---

### Task 7: Frontend query hooks and Russian formatting

**Files:**
- Modify: `apps/web/src/api/queries.ts`
- Modify: `apps/web/src/lib/format.ts`
- Test: manual, via Task 12's screenshots

**Interfaces:**
- Consumes: the routes from Task 6
- Produces: `useBudget`, `usePace`, `useTree`, `useCommitments`, `useCreateCommitment`, `useUpdateCommitment`, `useEndCommitment`; `monthLabel` and `dayLabel` returning Russian

- [ ] **Step 1: Switch the formatters to Russian**

In `apps/web/src/lib/format.ts`, replace the two `toLocaleDateString("en-GB", ...)` calls with `"ru-RU"`:

```typescript
/** "2026-08" to "август 2026". */
export function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  const date = new Date(Date.UTC(Number(year), Number(m) - 1, 1));
  return date.toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Unix seconds to "9 авг.". */
export function dayLabel(occurredOn: number): string {
  return new Date(occurredOn * 1000).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
```

- [ ] **Step 2: Add a weekday-aware day heading**

Append to `apps/web/src/lib/format.ts`:

```typescript
/** Unix seconds to "воскресенье, 9 августа" for grouping headings. */
export function dayHeading(occurredOn: number): string {
  return new Date(occurredOn * 1000).toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}
```

- [ ] **Step 3: Add the query hooks**

Append to `apps/web/src/api/queries.ts`:

```typescript
export function useBudget(month: string) {
  return useQuery({
    queryKey: ["budget", month],
    queryFn: async () => {
      const { data, error } = await client.api.budget.get({ query: { month } });
      if (error) throw error;
      return data;
    },
  });
}

export function usePace(month: string) {
  return useQuery({
    queryKey: ["pace", month],
    queryFn: async () => {
      const { data, error } = await client.api.pace.get({ query: { month } });
      if (error) throw error;
      return data;
    },
  });
}

export function useTree(month: string) {
  return useQuery({
    queryKey: ["tree", month],
    queryFn: async () => {
      const { data, error } = await client.api.tree.get({ query: { month } });
      if (error) throw error;
      return data;
    },
  });
}

export function useCommitments() {
  return useQuery({
    queryKey: ["commitments"],
    queryFn: async () => {
      const { data, error } = await client.api.commitments.get();
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateCommitment() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (input: {
      kind: "income" | "expense";
      name: string;
      amountMinor: number;
      categoryId?: number | null;
      activeFrom: string;
    }) => {
      const { data, error } = await client.api.commitments.post(input);
      if (error) throw new Error(errorMessage(error));
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateCommitment() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (input: { id: number; name?: string; amountMinor?: number }) => {
      const { id, ...patch } = input;
      const { data, error } = await client.api.commitments({ id: String(id) }).patch(patch);
      if (error) throw new Error(errorMessage(error));
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useEndCommitment() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (input: { id: number; month: string }) => {
      const { data, error } = await client.api
        .commitments({ id: String(input.id) })
        .delete(undefined, { query: { month: input.month } });
      if (error) throw new Error(errorMessage(error));
      return data;
    },
    onSuccess: invalidate,
  });
}
```

- [ ] **Step 4: Extend the invalidation list**

In `useInvalidateAll` inside the same file, add the new keys:

```typescript
    for (const key of [
      "summary",
      "trend",
      "breakdown",
      "transactions",
      "categories",
      "merchants",
      "budget",
      "pace",
      "tree",
      "commitments",
    ]) {
```

- [ ] **Step 5: Translate the error messages**

Replace the three strings in `errorMessage` in the same file:

```typescript
  if (error.status === 404) return "Эта запись больше не существует.";
  if (error.status === 422) {
    const value = error.value as { error?: string } | undefined;
    return value?.error ?? "Изменение отклонено: проверьте суммы и категорию.";
  }
  return "Не удалось сохранить. Сервер запущен?";
```

- [ ] **Step 6: Typecheck**

```bash
cd apps/web && bunx tsc --noEmit
```

Expected: no output. If Eden complains that `client.api.budget` does not exist, the server type has not been rebuilt — rerun `bun run dev` in `apps/server` and typecheck again.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/api/queries.ts apps/web/src/lib/format.ts
git commit -m "feat: query hooks for budget, pace and tree; Russian formatting"
```

---

### Task 8: SetAside headline component

**Files:**
- Create: `apps/web/src/components/SetAside.tsx`
- Delete: `apps/web/src/components/SavingsHeadline.tsx`

**Interfaces:**
- Consumes: `useBudget` (Task 7), `money` from `../lib/format`
- Produces: `<SetAside month={string} />`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/SetAside.tsx`:

```typescript
import { useBudget } from "../api/queries";
import { money } from "../lib/format";

/**
 * The page's one loud element: how much can leave the account on payday.
 *
 * Replaces the savings rate, which needed an income figure the database rarely has
 * and expressed the answer as a percentage — abstract where an amount is an
 * instruction. When the inputs are missing this says which one and for how long,
 * rather than showing a dash.
 */
export function SetAside({ month }: { month: string }) {
  const budget = useBudget(month);

  if (!budget.data) return null;
  const b = budget.data;

  return (
    <section>
      <h2 className="text-xs uppercase tracking-widest text-ink-300">Отложить в этом месяце</h2>

      {b.setAsideMinor !== null ? (
        <>
          <p className="tnum mt-3 text-6xl leading-none font-semibold text-gain">
            {money(b.setAsideMinor)} zł
          </p>
          <p className="tnum mt-2 text-sm text-ink-300">
            из {money(b.baseIncomeMinor ?? 0)} базы
          </p>
        </>
      ) : (
        <>
          <p className="mt-3 text-6xl leading-none font-semibold text-ink-300">—</p>
          <p className="mt-3 max-w-md text-sm text-ink-300">
            {b.reason === "no-base-income"
              ? "Добавьте зарплату в настройках, чтобы посчитать."
              : `Соберу за ${b.monthsNeeded} ${monthWord(b.monthsNeeded)}. Записано ${b.monthsObserved} из 3.`}
          </p>
        </>
      )}

      <dl className="mt-6 max-w-sm space-y-2 text-sm">
        <Row
          label="Обязательное"
          value={money(b.committedMinor)}
          hint="каждый месяц одно и то же"
        />
        <Row
          label="На жизнь"
          value={b.flexibleAverageMinor === null ? "…" : money(b.flexibleAverageMinor)}
          hint={b.flexibleAverageMinor === null ? "нужно 3 месяца истории" : "среднее за 3 месяца"}
        />
        <div className="border-t border-ink-700 pt-2">
          <Row
            label="Остаётся"
            value={b.setAsideMinor === null ? "—" : money(b.setAsideMinor)}
            hint=""
          />
        </div>
      </dl>
    </section>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-300">
        {label}
        {hint && <span className="ml-2 text-xs text-ink-700">{hint}</span>}
      </dt>
      <dd className="tnum tabular-nums">{value}</dd>
    </div>
  );
}

/** Russian needs the noun to agree with the count: 1 месяц, 2 месяца, 5 месяцев. */
function monthWord(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return "месяц";
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return "месяца";
  return "месяцев";
}
```

- [ ] **Step 2: Delete the old headline**

```bash
rm apps/web/src/components/SavingsHeadline.tsx
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/web && bunx tsc --noEmit
```

Expected: one error — `App.tsx` still imports `SavingsHeadline`. Task 11 fixes it. If you want a clean checkpoint now, comment out that import and its usage; Task 11 replaces the file wholesale either way.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/SetAside.tsx
git rm apps/web/src/components/SavingsHeadline.tsx
git commit -m "feat: set-aside headline replacing savings rate"
```

---

### Task 9: MonthPace component

**Files:**
- Create: `apps/web/src/components/MonthPace.tsx`
- Delete: `apps/web/src/components/MonthTotals.tsx`
- Delete: `apps/web/src/components/TrendChart.tsx`
- Delete: `apps/web/src/lib/useUntabbableChart.ts`

**Interfaces:**
- Consumes: `usePace` (Task 7), `money`
- Produces: `<MonthPace month={string} />`

`useUntabbableChart` existed only to stop Recharts stealing keyboard focus. With both charts gone it has no callers.

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/MonthPace.tsx`:

```typescript
import { usePace } from "../api/queries";
import { money } from "../lib/format";

/**
 * How the month is going: total, daily rate, and — once a budget exists — a bar
 * showing how much of it is used.
 *
 * Replaces the income/spending line chart, which drew a flat line and a vertical
 * cliff because income arrives once a month.
 */
export function MonthPace({ month }: { month: string }) {
  const pace = usePace(month);
  if (!pace.data) return null;
  const p = pace.data;

  const used =
    p.budgetMinor && p.budgetMinor > 0
      ? Math.min((p.spentMinor / p.budgetMinor) * 100, 100)
      : null;
  const over = p.budgetMinor !== null && p.spentMinor > p.budgetMinor;

  return (
    <section>
      <h2 className="text-xs uppercase tracking-widest text-ink-300">Потрачено</h2>

      <p className="tnum mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-3xl font-semibold">{money(p.spentMinor)} zł</span>
        {p.perDayMinor !== null && (
          <span className="text-sm text-ink-300">
            {money(p.perDayMinor)} zł в день
            {p.daysRemaining > 0 && ` · осталось ${p.daysRemaining} дн.`}
          </span>
        )}
      </p>

      {used !== null && (
        <>
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-ink-800">
            <div
              style={{ width: `${used}%` }}
              className={`h-full rounded-full ${over ? "bg-drain" : "bg-gain"}`}
            />
          </div>
          <p className="tnum mt-2 text-xs text-ink-300">
            из {money(p.budgetMinor!)} zł на жизнь
            {p.projectedMinor !== null && ` · к концу месяца выйдет ${money(p.projectedMinor)}`}
          </p>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Delete the replaced components**

```bash
rm apps/web/src/components/MonthTotals.tsx apps/web/src/components/TrendChart.tsx apps/web/src/lib/useUntabbableChart.ts
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/MonthPace.tsx
git rm apps/web/src/components/MonthTotals.tsx apps/web/src/components/TrendChart.tsx apps/web/src/lib/useUntabbableChart.ts
git commit -m "feat: month pace bar replacing totals and line chart"
```

---

### Task 10: SpendingTree component

**Files:**
- Create: `apps/web/src/components/SpendingTree.tsx`
- Delete: `apps/web/src/components/CategoryBreakdown.tsx`

**Interfaces:**
- Consumes: `useTree` (Task 7), `money`, `CategoryTreeNode` from `@paragon/shared`
- Produces: `<SpendingTree month={string} onSelect={(categoryId: number | null, name: string) => void} />`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/SpendingTree.tsx`:

```typescript
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
  month,
  onSelect,
}: {
  month: string;
  onSelect: (path: string, name: string) => void;
}) {
  const tree = useTree(month);
  if (!tree.data) return null;

  if (tree.data.length === 0) {
    return (
      <section>
        <h2 className="text-xs uppercase tracking-widest text-ink-300">Куда ушли деньги</h2>
        <p className="mt-4 text-sm text-ink-300">В этом месяце ещё ничего не записано.</p>
      </section>
    );
  }

  const widest = Math.max(...tree.data.map((n) => n.totalMinor), 1);

  return (
    <section>
      <h2 className="text-xs uppercase tracking-widest text-ink-300">Куда ушли деньги</h2>
      <ul className="mt-4">
        {tree.data.map((node) => (
          <Node key={node.categoryId ?? "none"} node={node} widest={widest} onSelect={onSelect} />
        ))}
      </ul>
    </section>
  );
}

function Node({
  node,
  widest,
  onSelect,
  depth = 0,
}: {
  node: CategoryTreeNode;
  widest: number;
  onSelect: (path: string, name: string) => void;
  depth?: number;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(node.path, node.name)}
        className="group flex w-full items-baseline gap-3 py-1.5 text-left hover:bg-ink-800/50"
      >
        <span className={depth === 0 ? "flex-1 text-sm" : "flex-1 text-sm text-ink-300"}>
          {node.name}
        </span>

        <span className="tnum w-24 text-right text-sm tabular-nums">
          {money(node.totalMinor)}
        </span>

        <span className="tnum w-10 text-right text-xs text-ink-300 tabular-nums">
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
        <ul className="ml-3 border-l border-ink-700 pl-3">
          {node.children.map((child) => (
            <Node
              key={child.categoryId ?? "none"}
              node={child}
              widest={widest}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
```

- [ ] **Step 2: Delete the donut**

```bash
rm apps/web/src/components/CategoryBreakdown.tsx
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/SpendingTree.tsx
git rm apps/web/src/components/CategoryBreakdown.tsx
git commit -m "feat: spending tree replacing donut chart"
```

---

### Task 11: Rebuild the dashboard and translate remaining copy

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/TransactionList.tsx`
- Modify: `apps/web/src/components/MonthPicker.tsx`
- Modify: `apps/web/src/components/CategoryTree.tsx`
- Modify: `apps/web/src/components/DataActions.tsx`
- Modify: `apps/web/src/components/TransactionEditor.tsx`
- Create: `apps/web/src/components/CommitmentsEditor.tsx`

**Interfaces:**
- Consumes: `SetAside` (Task 8), `MonthPace` (Task 9), `SpendingTree` (Task 10), commitment hooks (Task 7)
- Produces: the assembled dashboard and a settings view

- [ ] **Step 1: Write the commitments editor**

Create `apps/web/src/components/CommitmentsEditor.tsx`:

```typescript
import { useState } from "react";
import {
  useCommitments,
  useCreateCommitment,
  useEndCommitment,
  useCategories,
} from "../api/queries";
import { money, currentMonth } from "../lib/format";

/**
 * Declared monthly amounts: the base salary and recurring costs like rent.
 *
 * These cannot be derived from transactions — rent is known before it is paid, and
 * the payday figure is meaningless without it.
 */
export function CommitmentsEditor() {
  const commitments = useCommitments();
  const categories = useCategories();
  const create = useCreateCommitment();
  const end = useEndCommitment();

  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);

  const active = (commitments.data ?? []).filter((c) => c.activeTo === null);
  const error = create.error ?? end.error;

  // The picker only needs leaf-ish choices; a flat list keeps this simple.
  const flatCategories = (categories.data ?? []).flatMap((top) => [
    { id: top.id, label: top.name },
    ...top.children.map((child) => ({ id: child.id, label: `${top.name} / ${child.name}` })),
  ]);

  function submit() {
    const minor = Math.round(Number(amount.replace(",", ".")) * 100);
    if (!name.trim() || !Number.isFinite(minor) || minor <= 0) return;
    create.mutate(
      {
        kind,
        name: name.trim(),
        amountMinor: minor,
        categoryId: kind === "expense" ? categoryId : null,
        activeFrom: currentMonth(),
      },
      {
        onSuccess: () => {
          setName("");
          setAmount("");
        },
      },
    );
  }

  return (
    <section>
      <h2 className="text-xs uppercase tracking-widest text-ink-300">Постоянные суммы</h2>
      <p className="mt-2 max-w-xl text-sm text-ink-300">
        Зарплата и траты, которые повторяются каждый месяц. Из них считается, сколько можно
        отложить в день зарплаты.
      </p>

      <ul className="mt-5">
        {active.map((c) => (
          <li
            key={c.id}
            className="flex items-center gap-3 border-b border-ink-700 py-2 text-sm last:border-0"
          >
            <span className="flex-1">
              {c.name}
              <span className="ml-2 text-xs text-ink-300">
                {c.kind === "income" ? "доход" : "расход"} · с {c.activeFrom}
              </span>
            </span>
            <span className="tnum tabular-nums">{money(c.amountMinor)}</span>
            <button
              type="button"
              onClick={() => end.mutate({ id: c.id, month: currentMonth() })}
              className="rounded px-2 py-1 text-xs text-ink-300 hover:bg-drain/10 hover:text-drain"
            >
              Прекратить
            </button>
          </li>
        ))}
        {active.length === 0 && (
          <li className="py-2 text-sm text-ink-300">Пока ничего не добавлено.</li>
        )}
      </ul>

      {error && <p className="mt-3 text-sm text-drain">{error.message}</p>}

      <div className="mt-6 flex flex-wrap items-end gap-2 border-t border-ink-700 pt-4">
        <label className="text-xs text-ink-300">
          Что это
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "income" | "expense")}
            className="mt-1 block rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100"
          >
            <option value="expense">Расход</option>
            <option value="income">Зарплата</option>
          </select>
        </label>

        <label className="text-xs text-ink-300">
          Название
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Аренда"
            className="mt-1 block rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100"
          />
        </label>

        <label className="text-xs text-ink-300">
          Сумма
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="4000"
            className="mt-1 block w-28 rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100"
          />
        </label>

        {kind === "expense" && (
          <label className="text-xs text-ink-300">
            Категория
            <select
              value={categoryId ?? ""}
              onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
              className="mt-1 block rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-sm text-ink-100"
            >
              <option value="">Без категории</option>
              {flatCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={create.isPending}
          className="rounded bg-gain px-3 py-1.5 text-sm font-medium text-ink-900 disabled:opacity-40"
        >
          Добавить
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Rebuild App.tsx**

Replace `apps/web/src/App.tsx` entirely:

```typescript
import { useState } from "react";
import { useTransactions } from "./api/queries";
import { currentMonth } from "./lib/format";
import { MonthPicker } from "./components/MonthPicker";
import { SetAside } from "./components/SetAside";
import { MonthPace } from "./components/MonthPace";
import { SpendingTree } from "./components/SpendingTree";
import { TransactionList } from "./components/TransactionList";
import { TransactionEditor } from "./components/TransactionEditor";
import { CategoryTree } from "./components/CategoryTree";
import { CommitmentsEditor } from "./components/CommitmentsEditor";
import { DataActions } from "./components/DataActions";

export function App() {
  const [month, setMonth] = useState(currentMonth);
  const [view, setView] = useState<"dashboard" | "settings">("dashboard");
  const [filter, setFilter] = useState<{ path: string; name: string } | null>(null);

  const transactions = useTransactions(month);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-5">
          <h1 className="text-sm uppercase tracking-widest text-ink-300">Paragon</h1>
          <nav className="flex gap-3 text-sm">
            <button
              type="button"
              onClick={() => setView("dashboard")}
              className={view === "dashboard" ? "text-ink-100" : "text-ink-300 hover:text-ink-100"}
            >
              Месяц
            </button>
            <button
              type="button"
              onClick={() => setView("settings")}
              className={view === "settings" ? "text-ink-100" : "text-ink-300 hover:text-ink-100"}
            >
              Настройки
            </button>
          </nav>
        </div>
        {view === "dashboard" && <MonthPicker month={month} onChange={setMonth} />}
      </header>

      {view === "settings" && (
        <div className="mt-10 space-y-12">
          <CommitmentsEditor />
          <CategoryTree />
        </div>
      )}

      {view === "dashboard" && transactions.isError && (
        <p className="mt-10 text-drain">
          Сервер не отвечает. Запустите его: <code>bun run dev</code> в apps/server.
        </p>
      )}

      {view === "dashboard" && !transactions.isError && (
        <div className="mt-10 space-y-12">
          <SetAside month={month} />
          <MonthPace month={month} />
          <SpendingTree
            month={month}
            onSelect={(path, name) =>
              setFilter((f) => (f?.path === path ? null : { path, name }))
            }
          />
          {transactions.data && (
            <TransactionList
              rows={transactions.data.rows}
              filter={filter}
              onClearFilter={() => setFilter(null)}
              renderEditor={(row, close) => <TransactionEditor row={row} onClose={close} />}
            />
          )}
          <DataActions month={month} />
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Rewrite TransactionList with day grouping and filtering**

Replace `apps/web/src/components/TransactionList.tsx` entirely:

```typescript
import { useState, type ReactNode } from "react";
import { money, dayHeading } from "../lib/format";

/**
 * Mirrors `TransactionRow` from `apps/server/src/services/queries.ts`. The type is not
 * in `@paragon/shared` — it reaches the browser through Eden's inferred response type,
 * which cannot be named here without importing the whole app type.
 */
type Row = {
  id: number;
  occurredOn: number;
  type: string;
  totalMinor: number;
  currency: string;
  merchantRaw: string | null;
  note: string | null;
  lines: { id: number; amountMinor: number; categoryPath: string | null; note: string | null }[];
};

/**
 * Purchases grouped by day with a per-day subtotal.
 *
 * Every line of a split receipt is shown. The previous version collapsed them into
 * "Хозтовары +1", hiding exactly the breakdown that was entered by hand.
 */
export function TransactionList({
  rows,
  filter,
  onClearFilter,
  renderEditor,
}: {
  rows: Row[];
  filter: { path: string; name: string } | null;
  onClearFilter: () => void;
  renderEditor: (row: Row, close: () => void) => ReactNode;
}) {
  const [openId, setOpenId] = useState<number | null>(null);

  // Lines carry a full path ("Еда/Продукты"), so matching the first segment against a
  // parent picks up its children too: clicking "Еда" shows groceries and alcohol both.
  // The uncategorized node has an empty path, which selects lines with no category
  // at all rather than a branch.
  const visible = filter
    ? rows.filter((r) =>
        filter.path === ""
          ? r.lines.some((l) => l.categoryPath === null)
          : r.lines.some(
              (l) =>
                l.categoryPath === filter.path || l.categoryPath?.startsWith(`${filter.path}/`),
            ),
      )
    : rows;

  // Rows arrive newest first, so insertion order gives days in the right order.
  const byDay = new Map<string, Row[]>();
  for (const row of visible) {
    const key = dayHeading(row.occurredOn);
    byDay.set(key, [...(byDay.get(key) ?? []), row]);
  }

  return (
    <section>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xs uppercase tracking-widest text-ink-300">Покупки</h2>
        {filter && (
          <button
            type="button"
            onClick={onClearFilter}
            className="rounded border border-ink-700 px-2 py-1 text-xs text-ink-300 hover:bg-ink-800 hover:text-ink-100"
          >
            {filter.name} — показать все
          </button>
        )}
      </div>

      {visible.length === 0 && (
        <p className="mt-4 text-sm text-ink-300">Ничего не найдено.</p>
      )}

      {[...byDay.entries()].map(([day, dayRows]) => (
        <div key={day} className="mt-6">
          <div className="flex items-baseline justify-between border-b border-ink-700 pb-1">
            <h3 className="text-xs text-ink-300">{day}</h3>
            <span className="tnum text-xs text-ink-300 tabular-nums">
              {money(dayRows.reduce((sum, r) => sum + r.totalMinor, 0))}
            </span>
          </div>

          <ul>
            {dayRows.map((row) => (
              <li key={row.id} className="border-b border-ink-800 last:border-0">
                <button
                  type="button"
                  onClick={() => setOpenId(openId === row.id ? null : row.id)}
                  className="flex w-full items-baseline gap-3 py-2 text-left text-sm hover:bg-ink-800/50"
                >
                  <span className="flex-1">{row.merchantRaw ?? "Без названия"}</span>
                  <span className="tnum tabular-nums">−{money(row.totalMinor)}</span>
                </button>

                {/* Every line of a split receipt is shown; amounts appear only when
                    there is more than one, since a single line repeats the total. */}
                <ul className="pb-2">
                  {row.lines.map((line) => (
                    <li
                      key={line.id}
                      className="flex items-baseline gap-3 pl-4 text-xs text-ink-300"
                    >
                      <span className="flex-1">
                        {line.categoryPath ?? "Без категории"}
                        {line.note && ` · ${line.note}`}
                      </span>
                      {row.lines.length > 1 && (
                        <span className="tnum tabular-nums">{money(line.amountMinor)}</span>
                      )}
                    </li>
                  ))}
                </ul>

                {openId === row.id && (
                  <div className="pb-3">{renderEditor(row, () => setOpenId(null))}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
```

If the `Row` type here disagrees with what `/api/transactions` actually returns, read `apps/server/src/services/queries.ts` and match its shape exactly rather than casting.

- [ ] **Step 4: Translate the remaining components**

In `apps/web/src/components/CategoryTree.tsx`, replace the user-facing strings:

- `Categories` → `Категории`
- `fixed` badge → `постоянная`
- `flexible` option → `гибкая`
- `fixed` option → `постоянная`
- `Rename` → `Переименовать`
- `Archive` → `В архив`
- `New category` → `Новая категория`
- `Under` → `Внутри`
- `Top level` → `Верхний уровень`
- `Add` → `Добавить`
- `Name` placeholder → `Название`
- `aria-label` values: `New name for X` → `Новое название для X`, `Classification for X` → `Тип категории X`

In `apps/web/src/components/DataActions.tsx`:

- `Your data` → `Ваши данные`
- `This month as CSV` → `Этот месяц в CSV`
- `Everything as JSON` → `Всё в JSON`
- `Back up now` → `Сделать бэкап`
- `Backing up…` → `Сохраняю…`
- `` `Backed up ${...} KB.` `` → `` `Бэкап готов, ${...} КБ.` ``
- `Backup failed. Is the server running?` → `Бэкап не удался. Сервер запущен?`

In `apps/web/src/components/TransactionEditor.tsx`, translate every visible label and button. Read the file and replace each English string; do not guess at names that are not there.

- [ ] **Step 5: Typecheck**

```bash
cd apps/web && bunx tsc --noEmit
```

Expected: no output.

- [ ] **Step 6: Build**

```bash
cd apps/web && bun run build
```

Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat: rebuild dashboard around set-aside, translate interface to Russian"
```

---

### Task 12: Screenshot review

**Files:**
- Create: `apps/web/scripts/shots.mjs`

Curl cannot see wrapped amounts, a tree that reads as jitter, or a chart stealing focus. The last round of UI defects were all found this way.

- [ ] **Step 1: Write the screenshot script**

Create `apps/web/scripts/shots.mjs`:

```javascript
/**
 * Screenshots the dashboard at desktop and phone widths.
 *
 * Run with both servers up:
 *   cd apps/server && bun run dev
 *   cd apps/web && bun run dev
 *   node apps/web/scripts/shots.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.PARAGON_URL ?? "http://localhost:5173";
const OUT = process.env.PARAGON_SHOTS ?? ".";

const browser = await chromium.launch();
const shots = [
  { name: "dashboard-desktop", width: 1280, height: 1400, nav: null },
  { name: "dashboard-phone", width: 390, height: 1600, nav: null },
  { name: "settings", width: 1280, height: 1000, nav: "Настройки" },
];

for (const shot of shots) {
  const page = await browser.newPage({
    viewport: { width: shot.width, height: shot.height },
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  if (shot.nav) {
    await page.getByRole("button", { name: shot.nav }).click();
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${shot.name}.png`, fullPage: true });
  console.log("shot:", shot.name);
}

await browser.close();
```

- [ ] **Step 2: Run both servers and take the shots**

```bash
cd apps/server && bun run dev &
cd apps/web && bun run dev &
sleep 4
node apps/web/scripts/shots.mjs
```

- [ ] **Step 3: Look at every screenshot**

Open each PNG and check:

- No amount wraps to a second line at 390px.
- The tree's nesting reads as nesting — the left rule is visible, rows do not appear to jitter sideways.
- No English is left anywhere on screen.
- The set-aside block explains itself when the figure is unknown; no bare dash without a sentence beneath it.
- Tab through the page: focus order goes header, month picker, tree rows, purchases. Nothing traps it.

Fix anything found, then re-run the script.

- [ ] **Step 4: Run the whole suite**

```bash
bun test && cd apps/server && bunx tsc --noEmit && cd ../web && bunx tsc --noEmit
```

Expected: all tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/scripts/shots.mjs
git commit -m "chore: screenshot script for dashboard review"
```

---

## Self-review notes

**Spec coverage:** every section maps to a task — commitments table (1–2), set-aside calculation with all four rules (3), pace with projection (4), tree with deltas (5), routes (6), hooks and Russian formatting (7), the three replaced components (8–10), assembly plus translation plus commitments UI (11), screenshots (12). Removals named in the spec — donut, line chart, savings rate — happen in tasks 8–10 alongside their replacements.

**Deliberately deferred:** the monthly spending bar chart the spec mentions as a later replacement for the line chart. It needs several months of history to say anything, and none exists yet.

**Risk worth flagging at execution time:** Task 5's `getCategoryTreeBreakdown` recurses over the category tree, which the schema allows to nest without limit. A cycle in `parent_id` would hang it. `updateCategory` already rejects cycles, so this is defence against data edited outside the app — worth a guard if the tree is ever built from imported data.
