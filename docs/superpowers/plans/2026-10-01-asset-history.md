# Asset History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every account and holding a history worth opening — the movements that built a balance, the purchases behind a portfolio, and how its value changed over time.

**Architecture:** Two new tables (`lots` for purchases, `valuations` for the value over time), a history service that reads the account/holding columns already on `transactions`, two new MCP actions, and an expandable section per asset on the existing screen. `holdings.invested_minor` stops being typed at creation and is maintained by transfers alone.

**Tech Stack:** Bun, Elysia, Drizzle ORM, SQLite, React 19, Vite, Tailwind v4, TanStack Query, Eden Treaty, MCP SDK.

**Spec:** `docs/superpowers/specs/2026-10-01-asset-history-design.md`

## Global Constraints

- **Money in minor units** as integers. **Quantities in micro-units** (×1 000 000). **FX rates in millionths** — the convention `transactions.fxRate` already uses. **Rates in basis points.** Never floats.
- **Calendar days are `"YYYY-MM-DD"` text**; instants are Unix seconds. `reconcile.ts:dayStart` uses `Date.UTC` to match `transactions.occurredOn`; `assets.ts:dayOffset` uses local dates because it compares against human-entered day strings. Keep that split.
- **Errors that mean "no such row" must read `<Thing> not found: <id>`** — `app.ts:50` maps `/not found/i` to 404 and everything else a service throws to 422.
- **UI copy is Russian.**
- **Lots are never revalued.** They record what was true at purchase.
- **A lot does not change `invested_minor`.** Transfers do, in `addOne`.
- **Tests live in `apps/server/test/`** and import `./helpers/db` first. Run with `cd apps/server && bun test`. Typecheck via `cd apps/web && bun run build`.
- **Automatic backups skip when `DB_PATH` is set.** Do not remove that guard; a test run would otherwise write its fixtures into the real `backups/`.

## Review Focus

Five conditions the spec implies that the happy paths do not exercise. Each gets a test in the task that owns the code.

1. **A second valuation on a day that already has one** must replace it, not accumulate — the spec calls a same-day repeat a typo correction. Pinned to Task 2.
2. **Deleting a holding that has lots and valuations** must remove them too (ON DELETE cascade), not orphan rows that resurface against a later holding reusing the id. Pinned to Task 2.
3. **A lot whose quantity × price × rate disagrees with the stated cost** must be stored as given, not silently recomputed — the broker's figure is the fact. Pinned to Task 3.
4. **An account with no movements** must render an empty history, not crash the screen on an empty array. Pinned to Task 4.
5. **A running balance across a negative transfer** (how a withdrawal and a returned deposit are both recorded) must subtract, not add. Pinned to Task 4.

---

### Task 1: Schema and migration

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Create: `apps/server/drizzle/0006_asset_history.sql`
- Modify: `apps/server/drizzle/meta/_journal.json`
- Modify: `apps/server/test/helpers/db.ts`
- Test: `apps/server/test/lots.test.ts`

**Interfaces:**
- Consumes: `holdings` from the assets feature.
- Produces: `lots` and `valuations` Drizzle tables.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/lots.test.ts`:

```ts
import { describe, expect, test, beforeEach } from "bun:test";
import { db, schema, resetTestDb } from "./helpers/db";

describe("lots and valuations schema", () => {
  beforeEach(resetTestDb);

  test("stores a purchase with its quantity, price and rate", () => {
    const holding = db
      .insert(schema.holdings)
      .values({ name: "XTB", kind: "equity" })
      .returning()
      .get();

    db.insert(schema.lots)
      .values({
        holdingId: holding.id,
        boughtOn: "2026-05-07",
        quantityMicro: 4382300,
        priceMinor: 15792,
        currency: "EUR",
        fxRate: 4248200,
        costMinor: 293998,
      })
      .run();

    const row = db.select().from(schema.lots).get();
    expect(row?.quantityMicro).toBe(4382300);
    expect(row?.priceMinor).toBe(15792);
    expect(row?.fxRate).toBe(4248200);
    expect(row?.costMinor).toBe(293998);
  });

  test("stores a valuation against a day", () => {
    const holding = db
      .insert(schema.holdings)
      .values({ name: "XTB", kind: "equity" })
      .returning()
      .get();

    db.insert(schema.valuations)
      .values({ holdingId: holding.id, valuedOn: "2026-09-30", valueMinor: 1485795 })
      .run();

    const row = db.select().from(schema.valuations).get();
    expect(row?.valueMinor).toBe(1485795);
    expect(row?.valuedOn).toBe("2026-09-30");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && bun test test/lots.test.ts`
Expected: FAIL — `schema.lots` is undefined.

- [ ] **Step 3: Add the tables**

Append to `apps/server/src/db/schema.ts`:

```ts
/**
 * Individual purchases.
 *
 * A lot records what was true at the moment of buying and never changes: the broker
 * does not restate a completed trade. Growth per lot is deliberately absent — it would
 * need a current price for every lot at every revaluation, and the portfolio-level
 * figure answers the question without that bookkeeping.
 */
export const lots = sqliteTable(
  "lots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    holdingId: integer("holding_id")
      .notNull()
      .references(() => holdings.id, { onDelete: "cascade" }),
    boughtOn: text("bought_on").notNull(),
    // Units × 1 000 000. XTB reports four decimals (4.3823); three would round a digit
    // the broker actually gave us, and floats are not allowed near money.
    quantityMicro: integer("quantity_micro").notNull(),
    // Price per unit in the instrument's currency, minor units: 157.92 EUR is 15792.
    priceMinor: integer("price_minor").notNull(),
    currency: text("currency").notNull().default("EUR"),
    // Rate to PLN at purchase, in millionths — the convention transactions.fxRate uses.
    fxRate: integer("fx_rate"),
    // What the purchase cost in PLN, as the broker reported it. Recorded rather than
    // derived: for today's lots quantity × price × rate reproduces it to the grosz, but
    // that holds only while the rate is clean and no per-trade fee applies, and a figure
    // that is sometimes derived and sometimes stored is worse than one always recorded.
    costMinor: integer("cost_minor").notNull(),
    note: text("note"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => [index("lots_holding_idx").on(t.holdingId)],
);

/**
 * What a holding was worth, over time.
 *
 * `holdings.value_minor` keeps the newest figure and every existing reader goes on
 * working; this is the history behind it. Without it each revaluation erased the last,
 * so the portfolio's past was destroyed exactly as it accumulated.
 */
export const valuations = sqliteTable(
  "valuations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    holdingId: integer("holding_id")
      .notNull()
      .references(() => holdings.id, { onDelete: "cascade" }),
    valuedOn: text("valued_on").notNull(),
    valueMinor: integer("value_minor").notNull(),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  // One valuation per holding per day: revaluing twice in an afternoon is correcting a
  // typo, not recording a second fact.
  (t) => [uniqueIndex("valuations_holding_day_idx").on(t.holdingId, t.valuedOn)],
);
```

- [ ] **Step 4: Write the migration**

Create `apps/server/drizzle/0006_asset_history.sql`:

```sql
CREATE TABLE `lots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`holding_id` integer NOT NULL,
	`bought_on` text NOT NULL,
	`quantity_micro` integer NOT NULL,
	`price_minor` integer NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`fx_rate` integer,
	`cost_minor` integer NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`holding_id`) REFERENCES `holdings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lots_holding_idx` ON `lots` (`holding_id`);
--> statement-breakpoint
CREATE TABLE `valuations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`holding_id` integer NOT NULL,
	`valued_on` text NOT NULL,
	`value_minor` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`holding_id`) REFERENCES `holdings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `valuations_holding_day_idx` ON `valuations` (`holding_id`,`valued_on`);
```

Unlike `0005_assets.sql`, these are new tables, so the `FOREIGN KEY` clause carries
`ON DELETE cascade` properly — the `ALTER TABLE ADD COLUMN` limitation does not apply.

Append to `apps/server/drizzle/meta/_journal.json` an entry copying the shape of idx 5,
with `idx: 6`, `tag: "0006_asset_history"`, `when` set to the current epoch milliseconds.

- [ ] **Step 5: Extend the test reset helper**

In `apps/server/test/helpers/db.ts`, inside `resetTestDb`, delete the two new tables
**before** `schema.holdings` (they reference it):

```ts
  db.delete(schema.lineItems).run();
  db.delete(schema.transactions).run();
  db.delete(schema.lots).run();
  db.delete(schema.valuations).run();
  db.delete(schema.accounts).run();
  db.delete(schema.holdings).run();
```

- [ ] **Step 6: Run the test and the suite**

Run: `cd apps/server && bun test test/lots.test.ts && bun test`
Expected: the file passes 2/2; the suite passes with 2 more tests than before.

- [ ] **Step 7: Migrate the live database**

The suite builds its schema from scratch, so a passing suite does NOT prove the live
database was migrated. This was missed once already.

```bash
cd apps/server && bun run backup && bun run db:migrate
```

Expected: "Migrations applied."

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/drizzle/ apps/server/test/
git commit -m "feat: таблицы лотов и истории оценок"
```

---

### Task 2: Lots and valuations service

**Files:**
- Modify: `apps/server/src/services/assets.ts`
- Test: `apps/server/test/lots.test.ts`

**Interfaces:**
- Consumes: `lots`, `valuations` (Task 1); `createHolding`, `revalueHolding` (existing).
- Produces:
  - `type Lot = { id, holdingId, boughtOn, quantityMicro, priceMinor, currency, fxRate, costMinor, note }`
  - `type Valuation = { id, valuedOn, valueMinor }`
  - `addLot(input: LotInput): Lot`
  - `listLots(holdingId: number): Lot[]`
  - `listValuations(holdingId: number): Valuation[]`
  - `revalueHolding` additionally appends to `valuations`

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test/lots.test.ts`:

```ts
import {
  createHolding,
  revalueHolding,
  addLot,
  listLots,
  listValuations,
} from "../src/services/assets";

describe("lots service", () => {
  beforeEach(resetTestDb);

  test("records a purchase and lists it", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    addLot({
      holdingId: xtb.id,
      boughtOn: "2026-05-07",
      quantityMicro: 4382300,
      priceMinor: 15792,
      currency: "EUR",
      fxRate: 4248200,
      costMinor: 293998,
    });

    const lots = listLots(xtb.id);
    expect(lots).toHaveLength(1);
    expect(lots[0]?.costMinor).toBe(293998);
  });

  test("lots are listed oldest first, so the story reads forwards", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    for (const day of ["2026-09-10", "2026-05-07", "2026-08-10"]) {
      addLot({
        holdingId: xtb.id,
        boughtOn: day,
        quantityMicro: 1000000,
        priceMinor: 16000,
        currency: "EUR",
        fxRate: 4300000,
        costMinor: 68800,
      });
    }
    expect(listLots(xtb.id).map((l) => l.boughtOn)).toEqual([
      "2026-05-07",
      "2026-08-10",
      "2026-09-10",
    ]);
  });

  // Review Focus 3: the broker's cost is the fact, not a derived figure.
  test("stores the stated cost even when it disagrees with the arithmetic", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    // 1.0 unit at 100.00 EUR at rate 4.0 would be 400.00; the broker charged 405.00.
    addLot({
      holdingId: xtb.id,
      boughtOn: "2026-05-07",
      quantityMicro: 1000000,
      priceMinor: 10000,
      currency: "EUR",
      fxRate: 4000000,
      costMinor: 40500,
    });
    expect(listLots(xtb.id)[0]?.costMinor).toBe(40500);
  });

  test("a lot does not move what was invested", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 300000 });
    addLot({
      holdingId: xtb.id,
      boughtOn: "2026-05-07",
      quantityMicro: 1000000,
      priceMinor: 10000,
      currency: "EUR",
      fxRate: 4000000,
      costMinor: 40000,
    });
    expect(listHoldings()[0]?.investedMinor).toBe(300000);
  });

  test("refuses a lot on a holding that does not exist", () => {
    expect(() =>
      addLot({
        holdingId: 999,
        boughtOn: "2026-05-07",
        quantityMicro: 1000000,
        priceMinor: 10000,
        currency: "EUR",
        fxRate: 4000000,
        costMinor: 40000,
      }),
    ).toThrow("Holding not found: 999");
  });
});

describe("valuation history", () => {
  beforeEach(resetTestDb);

  test("every revaluation is kept", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    revalueHolding(xtb.id, 1400000, "2026-08-31");
    revalueHolding(xtb.id, 1485795, "2026-09-30");

    expect(listValuations(xtb.id)).toEqual([
      expect.objectContaining({ valuedOn: "2026-08-31", valueMinor: 1400000 }),
      expect.objectContaining({ valuedOn: "2026-09-30", valueMinor: 1485795 }),
    ]);
  });

  // Review Focus 1: a same-day repeat is a correction, not a second fact.
  test("revaluing twice on one day replaces rather than accumulates", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    revalueHolding(xtb.id, 1400000, "2026-09-30");
    revalueHolding(xtb.id, 1485795, "2026-09-30");

    const history = listValuations(xtb.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.valueMinor).toBe(1485795);
  });

  // Review Focus 2: cascade, so a reused id cannot inherit a dead holding's history.
  test("deleting a holding takes its lots and valuations with it", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    addLot({
      holdingId: xtb.id,
      boughtOn: "2026-05-07",
      quantityMicro: 1000000,
      priceMinor: 10000,
      currency: "EUR",
      fxRate: 4000000,
      costMinor: 40000,
    });
    revalueHolding(xtb.id, 1485795, "2026-09-30");

    db.delete(schema.holdings).where(eq(schema.holdings.id, xtb.id)).run();

    expect(db.select().from(schema.lots).all()).toHaveLength(0);
    expect(db.select().from(schema.valuations).all()).toHaveLength(0);
  });
});
```

Add `import { eq } from "drizzle-orm";` and `listHoldings` to the imports at the top of
the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && bun test test/lots.test.ts`
Expected: FAIL — `addLot` is not exported.

- [ ] **Step 3: Implement**

Append to `apps/server/src/services/assets.ts`, and add `lots, valuations` to the
`import ... from "../db/schema"` line:

```ts
export type Lot = {
  id: number;
  holdingId: number;
  boughtOn: string;
  quantityMicro: number;
  priceMinor: number;
  currency: string;
  fxRate: number | null;
  costMinor: number;
  note: string | null;
};

export type LotInput = {
  holdingId: number;
  boughtOn: string;
  quantityMicro: number;
  priceMinor: number;
  currency?: string;
  fxRate?: number | null;
  costMinor: number;
  note?: string | null;
};

export type Valuation = { id: number; valuedOn: string; valueMinor: number };

function requireHolding(id: number): void {
  if (!db.select().from(holdings).where(eq(holdings.id, id)).get()) {
    throw new Error(`Holding not found: ${id}`);
  }
}

/**
 * Records one purchase.
 *
 * Deliberately does not touch `invested_minor`: that is the sum of what left the card,
 * and transfers maintain it. A lot is what the broker bought with the money after
 * conversion and fees — 14 380.00 was transferred, 14 378.54 reached the shares, and
 * both figures are true about different things.
 */
export function addLot(input: LotInput): Lot {
  requireHolding(input.holdingId);

  const row = db
    .insert(lots)
    .values({
      holdingId: input.holdingId,
      boughtOn: input.boughtOn,
      quantityMicro: input.quantityMicro,
      priceMinor: input.priceMinor,
      currency: input.currency ?? "EUR",
      fxRate: input.fxRate ?? null,
      costMinor: input.costMinor,
      note: input.note ?? null,
    })
    .returning()
    .get();

  return { ...row };
}

/** Oldest first: a purchase history reads forwards. */
export function listLots(holdingId: number): Lot[] {
  return db
    .select()
    .from(lots)
    .where(eq(lots.holdingId, holdingId))
    .orderBy(asc(lots.boughtOn), asc(lots.id))
    .all()
    .map((row) => ({ ...row }));
}

export function listValuations(holdingId: number): Valuation[] {
  return db
    .select()
    .from(valuations)
    .where(eq(valuations.holdingId, holdingId))
    .orderBy(asc(valuations.valuedOn))
    .all()
    .map((row) => ({ id: row.id, valuedOn: row.valuedOn, valueMinor: row.valueMinor }));
}
```

Then change `revalueHolding` to append history. Replace its body's update block with:

```ts
  const row = db
    .update(holdings)
    .set({ valueMinor, valuedAt })
    .where(eq(holdings.id, id))
    .returning()
    .get();

  // History behind the headline figure. A repeat on the same day replaces rather than
  // accumulates: revaluing twice in an afternoon is fixing a typo.
  db.insert(valuations)
    .values({ holdingId: id, valuedOn: valuedAt, valueMinor })
    .onConflictDoUpdate({
      target: [valuations.holdingId, valuations.valuedOn],
      set: { valueMinor },
    })
    .run();

  return toHolding(row);
```

- [ ] **Step 4: Stop typing `invested` at creation**

The spec narrows `invested_minor` to transfers alone. In `createHolding`, keep accepting
`investedMinor` (the backfill in Task 6 needs a way to set an opening figure, and
`HoldingInput` already carries it) but add the comment that it is an opening value only:

```ts
      // An opening figure only. After creation this is moved by transfers, never typed:
      // see addOne in transactions.ts.
      investedMinor: input.investedMinor,
```

- [ ] **Step 5: Run the test and the suite**

Run: `cd apps/server && bun test test/lots.test.ts && bun test`
Expected: the file passes 8/8; the whole suite green.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/assets.ts apps/server/test/lots.test.ts
git commit -m "feat: сервис лотов и истории оценок"
```

---

### Task 3: Asset history service

**Files:**
- Create: `apps/server/src/services/asset-history.ts`
- Test: `apps/server/test/asset-history.test.ts`

**Interfaces:**
- Consumes: `transactions` with the four asset columns; `listLots`, `listValuations` (Task 2).
- Produces:
  - `type Movement = { id, occurredOn, totalMinor, note, merchant, runningMinor }`
  - `accountHistory(accountId: number): { movements: Movement[] }`
  - `holdingHistory(holdingId: number): { movements: Movement[]; lots: Lot[]; valuations: Valuation[] }`

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/asset-history.test.ts`:

```ts
import { describe, expect, test, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { createAccount, createHolding, addLot, revalueHolding } from "../src/services/assets";
import { addTransactions } from "../src/services/transactions";
import { accountHistory, holdingHistory } from "../src/services/asset-history";

describe("account history", () => {
  beforeEach(resetTestDb);

  // Review Focus 4: nothing recorded yet must not crash the caller.
  test("an account with no movements has an empty history", () => {
    const pko = createAccount({
      name: "PKO",
      balanceMinor: 100000,
      openingMinor: 100000,
      openedOn: "2026-07-31",
    });
    expect(accountHistory(pko.id).movements).toEqual([]);
  });

  test("movements come back oldest first with a running balance", () => {
    const pko = createAccount({
      name: "PKO",
      balanceMinor: 1400000,
      openingMinor: 100000,
      openedOn: "2026-07-31",
    });
    addTransactions([
      { date: "2026-08-10", total: "4000.00", type: "transfer", toAccountId: pko.id },
      { date: "2026-09-10", total: "9000.00", type: "transfer", toAccountId: pko.id },
    ]);

    const movements = accountHistory(pko.id).movements;
    expect(movements.map((m) => m.runningMinor)).toEqual([500000, 1400000]);
  });

  // Review Focus 5: a withdrawal is a negative transfer, not a separate direction.
  test("a negative transfer lowers the running balance", () => {
    const pko = createAccount({
      name: "PKO",
      balanceMinor: 300000,
      openingMinor: 400000,
      openedOn: "2026-07-31",
    });
    addTransactions([
      { date: "2026-09-21", total: "-1000.00", type: "transfer", toAccountId: pko.id },
    ]);
    expect(accountHistory(pko.id).movements[0]?.runningMinor).toBe(300000);
  });

  test("money leaving the account lowers it too", () => {
    const pko = createAccount({
      name: "PKO",
      balanceMinor: 300000,
      openingMinor: 400000,
      openedOn: "2026-07-31",
    });
    addTransactions([
      { date: "2026-09-21", total: "1000.00", type: "transfer", fromAccountId: pko.id },
    ]);
    expect(accountHistory(pko.id).movements[0]?.runningMinor).toBe(300000);
  });

  test("another account's movements do not leak in", () => {
    const a = createAccount({ name: "A", balanceMinor: 0, openingMinor: 0 });
    const b = createAccount({ name: "B", balanceMinor: 0, openingMinor: 0 });
    addTransactions([
      { date: "2026-09-10", total: "100.00", type: "transfer", toAccountId: b.id },
    ]);
    expect(accountHistory(a.id).movements).toEqual([]);
  });
});

describe("holding history", () => {
  beforeEach(resetTestDb);

  test("carries movements, purchases and valuations together", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    addTransactions([
      { date: "2026-09-10", total: "4630.00", type: "transfer", toHoldingId: xtb.id },
    ]);
    addLot({
      holdingId: xtb.id,
      boughtOn: "2026-09-10",
      quantityMicro: 6293300,
      priceMinor: 16616,
      currency: "EUR",
      fxRate: 4341700,
      costMinor: 454009,
    });
    revalueHolding(xtb.id, 1485795, "2026-09-30");

    const history = holdingHistory(xtb.id);
    expect(history.movements).toHaveLength(1);
    expect(history.lots).toHaveLength(1);
    expect(history.valuations).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && bun test test/asset-history.test.ts`
Expected: FAIL — cannot resolve `../src/services/asset-history`.

- [ ] **Step 3: Implement**

Create `apps/server/src/services/asset-history.ts`:

```ts
import { eq, or, asc } from "drizzle-orm";
import { db } from "../db";
import { transactions, accounts } from "../db/schema";
import { listLots, listValuations, type Lot, type Valuation } from "./assets";

export type Movement = {
  id: number;
  occurredOn: number;
  totalMinor: number;
  note: string | null;
  merchant: string | null;
  // Balance after this movement, counted forward from the account's opening figure.
  runningMinor: number;
};

/**
 * What built a balance.
 *
 * The running total starts at the account's opening figure and moves with each row, so
 * the last line should equal what the account says it holds. When it does not, the
 * reconciliation warning on the same screen already explains why.
 *
 * Direction comes from which column names the account, with one wrinkle: a negative
 * total pointing *into* an account is how a withdrawal and a returned deposit are both
 * recorded, and adding a negative handles it without a special case.
 */
export function accountHistory(accountId: number): { movements: Movement[] } {
  const rows = db
    .select({
      id: transactions.id,
      occurredOn: transactions.occurredOn,
      totalMinor: transactions.totalMinor,
      note: transactions.note,
      merchantRaw: transactions.merchantRaw,
      toAccountId: transactions.toAccountId,
    })
    .from(transactions)
    .where(
      or(eq(transactions.toAccountId, accountId), eq(transactions.fromAccountId, accountId)),
    )
    .orderBy(asc(transactions.occurredOn), asc(transactions.id))
    .all();

  // The running total starts where the account did, not at zero, so the last line can
  // be compared against what the account says it holds today.
  const account = db
    .select({ openingMinor: accounts.openingMinor })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .get();

  let running = account?.openingMinor ?? 0;
  const movements = rows.map((row) => {
    const delta = row.toAccountId === accountId ? row.totalMinor : -row.totalMinor;
    running += delta;
    return {
      id: row.id,
      occurredOn: row.occurredOn,
      totalMinor: delta,
      note: row.note,
      merchant: row.merchantRaw,
      runningMinor: running,
    };
  });

  return { movements };
}

export function holdingHistory(holdingId: number): {
  movements: Movement[];
  lots: Lot[];
  valuations: Valuation[];
} {
  const rows = db
    .select({
      id: transactions.id,
      occurredOn: transactions.occurredOn,
      totalMinor: transactions.totalMinor,
      note: transactions.note,
      merchantRaw: transactions.merchantRaw,
      toHoldingId: transactions.toHoldingId,
    })
    .from(transactions)
    .where(
      or(eq(transactions.toHoldingId, holdingId), eq(transactions.fromHoldingId, holdingId)),
    )
    .orderBy(asc(transactions.occurredOn), asc(transactions.id))
    .all();

  let running = 0;
  const movements = rows.map((row) => {
    const delta = row.toHoldingId === holdingId ? row.totalMinor : -row.totalMinor;
    running += delta;
    return {
      id: row.id,
      occurredOn: row.occurredOn,
      totalMinor: delta,
      note: row.note,
      merchant: row.merchantRaw,
      runningMinor: running,
    };
  });

  return { movements, lots: listLots(holdingId), valuations: listValuations(holdingId) };
}
```

A holding's running total starts at zero rather than at an opening figure: holdings have
no equivalent of `opening_minor`, and their `invested` is maintained by the same
transfers this list walks.

- [ ] **Step 4: Run the test and the suite**

Run: `cd apps/server && bun test test/asset-history.test.ts && bun test`
Expected: the file passes 6/6; the whole suite green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/asset-history.ts apps/server/test/asset-history.test.ts
git commit -m "feat: лента движений по счёту и вложению"
```

---

### Task 4: Routes

**Files:**
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/test/routes-asset-history.test.ts`

**Interfaces:**
- Consumes: `accountHistory`, `holdingHistory` (Task 3); `addLot` (Task 2).
- Produces: `GET /api/accounts/:id/history`, `GET /api/holdings/:id/history`, `POST /api/holdings/:id/lots`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/routes-asset-history.test.ts`:

```ts
import { describe, expect, test, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { app } from "../src/app";
import { createAccount, createHolding } from "../src/services/assets";
import { addTransactions } from "../src/services/transactions";

async function api(path: string, init?: RequestInit) {
  return app.handle(new Request(`http://localhost${path}`, init));
}

function send(path: string, method: string, body: unknown) {
  return api(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("asset history routes", () => {
  beforeEach(resetTestDb);

  test("GET /accounts/:id/history returns the movements", async () => {
    const pko = createAccount({
      name: "PKO",
      balanceMinor: 500000,
      openingMinor: 100000,
      openedOn: "2026-07-31",
    });
    addTransactions([
      { date: "2026-08-10", total: "4000.00", type: "transfer", toAccountId: pko.id },
    ]);

    const res = await api(`/api/accounts/${pko.id}/history`);
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.movements).toHaveLength(1);
    expect(body.movements[0].runningMinor).toBe(500000);
  });

  test("GET /holdings/:id/history carries lots and valuations", async () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });

    await send(`/api/holdings/${xtb.id}/lots`, "POST", {
      boughtOn: "2026-05-07",
      quantityMicro: 4382300,
      priceMinor: 15792,
      currency: "EUR",
      fxRate: 4248200,
      costMinor: 293998,
    });

    const res = await api(`/api/holdings/${xtb.id}/history`);
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.lots).toHaveLength(1);
    expect(body.lots[0].costMinor).toBe(293998);
  });

  test("a lot on a holding that does not exist is refused", async () => {
    const res = await send("/api/holdings/999/lots", "POST", {
      boughtOn: "2026-05-07",
      quantityMicro: 1000000,
      priceMinor: 10000,
      currency: "EUR",
      fxRate: 4000000,
      costMinor: 40000,
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && bun test test/routes-asset-history.test.ts`
Expected: FAIL — 404 on the history route.

- [ ] **Step 3: Add the routes**

In `apps/server/src/app.ts`, import `accountHistory`/`holdingHistory` from
`./services/asset-history` and `addLot` from `./services/assets`, then add the routes
beside the existing `/assets` block. Declare a `response` schema on both GETs — without
one Eden infers `{}` and the frontend's field access is unchecked, which is why
`/assets` has one:

```ts
  .get("/accounts/:id/history", ({ params }) => accountHistory(Number(params.id)), {
    params: t.Object({ id: t.String() }),
    response: t.Object({
      movements: t.Array(
        t.Object({
          id: t.Number(),
          occurredOn: t.Number(),
          totalMinor: t.Number(),
          note: t.Union([t.String(), t.Null()]),
          merchant: t.Union([t.String(), t.Null()]),
          runningMinor: t.Number(),
        }),
      ),
    }),
  })

  .get("/holdings/:id/history", ({ params }) => holdingHistory(Number(params.id)), {
    params: t.Object({ id: t.String() }),
    response: t.Object({
      movements: t.Array(
        t.Object({
          id: t.Number(),
          occurredOn: t.Number(),
          totalMinor: t.Number(),
          note: t.Union([t.String(), t.Null()]),
          merchant: t.Union([t.String(), t.Null()]),
          runningMinor: t.Number(),
        }),
      ),
      lots: t.Array(
        t.Object({
          id: t.Number(),
          holdingId: t.Number(),
          boughtOn: t.String(),
          quantityMicro: t.Number(),
          priceMinor: t.Number(),
          currency: t.String(),
          fxRate: t.Union([t.Number(), t.Null()]),
          costMinor: t.Number(),
          note: t.Union([t.String(), t.Null()]),
        }),
      ),
      valuations: t.Array(
        t.Object({ id: t.Number(), valuedOn: t.String(), valueMinor: t.Number() }),
      ),
    }),
  })

  .post(
    "/holdings/:id/lots",
    ({ params, body }) => addLot({ holdingId: Number(params.id), ...body }),
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        boughtOn: t.String({ pattern: dayPattern }),
        quantityMicro: t.Integer(),
        priceMinor: t.Integer(),
        currency: t.Optional(t.String({ minLength: 3, maxLength: 3 })),
        fxRate: t.Optional(t.Union([t.Integer(), t.Null()])),
        costMinor: t.Integer(),
        note: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    },
  )
```

- [ ] **Step 4: Run the test, the suite and the typecheck**

Run: `cd apps/server && bun test && cd ../web && bun run build`
Expected: suite green, web build clean.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/app.ts apps/server/test/routes-asset-history.test.ts
git commit -m "feat: маршруты истории активов"
```

---

### Task 5: MCP entry for lots

**Files:**
- Modify: `apps/server/src/mcp/tools/record-asset.ts`
- Modify: `apps/server/src/mcp/tools/list-assets.ts`
- Test: `apps/server/test/mcp-assets.test.ts`

**Interfaces:**
- Consumes: `addLot`, `listLots` (Task 2).
- Produces: `record_asset` gains `action: "add_lot"`; `list_assets` reports lot counts.

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test/mcp-assets.test.ts`:

```ts
describe("record_asset add_lot", () => {
  beforeEach(resetTestDb);

  test("records a purchase and names the holding", async () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    const result = await recordAsset({
      action: "add_lot",
      id: xtb.id,
      boughtOn: "2026-05-07",
      quantityMicro: 4382300,
      priceMinor: 15792,
      currency: "EUR",
      fxRate: 4248200,
      costMinor: 293998,
    });
    expect(result.content[0]?.text).toContain("XTB");
    expect(result.content[0]?.text).toContain("2939.98");
  });

  test("refuses a purchase with no holding", async () => {
    expect(
      recordAsset({
        action: "add_lot",
        boughtOn: "2026-05-07",
        quantityMicro: 1000000,
        priceMinor: 10000,
        costMinor: 40000,
      }),
    ).rejects.toThrow("add_lot needs the holding id");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/server && bun test test/mcp-assets.test.ts`
Expected: FAIL — `add_lot` is not an accepted action.

- [ ] **Step 3: Extend the tool**

In `apps/server/src/mcp/tools/record-asset.ts`:

1. Widen the action enum in `inputSchema` and in `RecordAssetInput` to include
   `"add_lot"`, with a description: `"add_lot records one purchase: date, quantity, price, rate and what it cost in PLN."`
2. Add the optional fields `boughtOn`, `quantityMicro`, `priceMinor`, `fxRate`,
   `costMinor` to both, each with a `.describe(...)` naming its units — quantities are
   ×1 000 000, prices are minor units of the instrument's currency, rates are millionths.
3. Add the branch before the `revalue` branch:

```ts
  if (input.action === "add_lot") {
    if (input.id === undefined) throw new Error("add_lot needs the holding id");
    if (!input.boughtOn) throw new Error("add_lot needs boughtOn");
    if (input.quantityMicro === undefined) throw new Error("add_lot needs quantityMicro");
    if (input.priceMinor === undefined) throw new Error("add_lot needs priceMinor");
    if (input.costMinor === undefined) throw new Error("add_lot needs costMinor");

    const holding = listHoldings().find((h) => h.id === input.id);
    if (!holding) throw new Error(`Holding not found: ${input.id}`);

    const lot = addLot({
      holdingId: input.id,
      boughtOn: requireDay(input.boughtOn, "boughtOn"),
      quantityMicro: input.quantityMicro,
      priceMinor: input.priceMinor,
      currency: input.currency ?? "EUR",
      fxRate: input.fxRate ?? null,
      costMinor: input.costMinor,
    });

    return {
      content: [
        {
          type: "text" as const,
          text:
            `Recorded lot #${lot.id} for ${holding.name}: ` +
            `${(lot.quantityMicro / 1e6).toFixed(4)} units at ${formatMinor(lot.priceMinor)} ${lot.currency} ` +
            `on ${lot.boughtOn}, ${formatMinor(lot.costMinor)} PLN`,
        },
      ],
    };
  }
```

Note the `currency` field already exists on the input for accounts; reuse it rather than
adding a second one.

4. In `list-assets.ts`, append the lot count to each holding's line so the next call
   knows whether purchases are recorded: `, N purchases` when `listLots(h.id).length > 0`.

- [ ] **Step 4: Run the test and the suite**

Run: `cd apps/server && bun test`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/mcp/ apps/server/test/mcp-assets.test.ts
git commit -m "feat: MCP вносит покупки лотами"
```

---

### Task 6: The expandable screen

**Files:**
- Modify: `apps/web/src/components/Assets.tsx`
- Modify: `apps/web/src/api/queries.ts`

**Interfaces:**
- Consumes: `GET /api/accounts/:id/history`, `GET /api/holdings/:id/history` (Task 4).
- Produces: expandable rows on the assets screen.

- [ ] **Step 1: Add the query hooks**

In `apps/web/src/api/queries.ts`, following the shape of `useAssets`:

```ts
export function useAccountHistory(id: number | null) {
  return useQuery({
    queryKey: ["account-history", id],
    enabled: id !== null,
    queryFn: async () => {
      const { data, error } = await client.api.accounts({ id: String(id) }).history.get();
      if (error) throw error;
      return data;
    },
  });
}

export function useHoldingHistory(id: number | null) {
  return useQuery({
    queryKey: ["holding-history", id],
    enabled: id !== null,
    queryFn: async () => {
      const { data, error } = await client.api.holdings({ id: String(id) }).history.get();
      if (error) throw error;
      return data;
    },
  });
}
```

Add `"account-history"` and `"holding-history"` to the key list in `useInvalidateAll`.

- [ ] **Step 2: Make rows expandable**

In `apps/web/src/components/Assets.tsx`, hold which row is open:

```tsx
const [openAccount, setOpenAccount] = useState<number | null>(null);
const [openHolding, setOpenHolding] = useState<number | null>(null);
```

Each account row becomes a `<button>` that toggles `openAccount`, and when open renders
the movements: date via `dayLabel(occurredOn)` from `../lib/format`, the amount via
`money`, the note, and the running balance in a muted column. An empty list renders
`Движений пока нет.` rather than an empty table.

Each holding row toggles `openHolding` and renders three blocks, each omitted when empty:

- `Движения` — same shape as an account's.
- `Покупки` — one row per lot: `boughtOn`, `(quantityMicro / 1e6).toFixed(4)` units,
  `money(priceMinor)` with the lot's `currency`, the rate as `(fxRate / 1e6).toFixed(4)`,
  and `money(costMinor)` zł.
- `Оценки` — the valuations. With three or more points draw a simple inline SVG
  sparkline (no chart library — none is installed and the CDN is not available); with
  fewer, list them as `valuedOn — money(valueMinor) zł`.

- [ ] **Step 3: Check it builds and renders**

Run: `cd apps/web && bun run build`
Expected: clean.

Then with both dev servers up, open the Активы tab and expand the savings account: five
movements should appear, the last running balance matching the stated figure. Expand
XTB: movements, purchases and valuations.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/
git commit -m "feat: раскрытие активов — движения, покупки, оценки"
```

---

### Task 7: Backfill the real data

This task is data entry against the live database, run after Task 6 is merged. Every
figure below is from the owner's XTB screenshots of 2026-09-30 and has been checked:
quantity × price × rate reproduces each stated cost to the grosz.

**Files:** none — data only.

- [ ] **Step 1: Back up first**

```bash
cd apps/server && bun run backup
```

- [ ] **Step 2: Record the May transfer**

Through `add_transactions`: 3 000.00 on 2026-05-07, `type: "transfer"`,
`toHoldingId` = the XTB holding, note that it was entered retrospectively — bookkeeping
began in August and this purchase predates it. Transfers do not open pay periods, so a
date before every recorded period is harmless.

- [ ] **Step 3: Correct `invested_minor`**

After step 2 the transfers into XTB total 14 380.00 (2 750 + 4 000 + 4 630 + 3 000), but
the holding still carries 14 378.54 typed in at creation plus whatever the transfer
added. Set it to exactly `1438000`.

- [ ] **Step 4: Record the five lots**

| Bought | quantityMicro | priceMinor | fxRate | costMinor |
|---|---|---|---|---|
| 2026-05-07 | 4382300 | 15792 | 4248200 | 293998 |
| 2026-08-10 | 9167400 | 16842 | 4322700 | 667413 |
| 2026-08-10 | 183400 | 16844 | 4322600 | 13353 |
| 2026-09-10 | 6293300 | 16616 | 4341700 | 454009 |
| 2026-09-10 | 125900 | 16614 | 4341600 | 9081 |

All `currency: "EUR"`. They total 14 378.54 — the broker's figure, 1.46 below the
14 380.00 transferred, which is conversion and commission.

- [ ] **Step 5: Seed the valuation already known**

`revalue` the holding to 14 857.95 on 2026-09-30. It is already the current figure, so
this only writes the history row.

- [ ] **Step 6: Verify**

```bash
cd apps/server && bun -e '
const { Database } = require("bun:sqlite");
const db = new Database("paragon.db", { readonly: true });
const h = db.query("SELECT invested_minor i, value_minor v FROM holdings WHERE id=1").get();
const lots = db.query("SELECT SUM(cost_minor) c, COUNT(*) n FROM lots WHERE holding_id=1").get();
console.log("invested:", h.i / 100, "(expect 14380)");
console.log("lots:", lots.n, "totalling", lots.c / 100, "(expect 5, 14378.54)");
console.log("value:", h.v / 100, "(expect 14857.95)");
'
```

Then open the Активы tab and expand XTB: four movements, five purchases, one valuation.

- [ ] **Step 7: Update the notes**

In `~/projects/platform-notes/paragon-expense-tracker/`:
- `finances.md` — that lots are recorded per purchase, that `invested` is the sum of
  transfers (14 380.00) while the lots total the broker's 14 378.54, and that the
  difference is conversion and commission.
- `state.md` — the two new tables and the expandable screen.
