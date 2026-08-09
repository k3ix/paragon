# Paragon Phase 1 — Skeleton and End-to-End Write Path

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A receipt photo sent to a Claude chat becomes correctly split rows in a SQLite database, and sending the same receipt twice does not create a duplicate.

**Architecture:** A Bun monorepo with three workspaces. `packages/shared` holds Zod schemas and types. `apps/server` holds the Drizzle schema, a service layer, and an MCP server over stdio. MCP tools call the service layer rather than touching the database directly — deduplication and the line-sum invariant live in one place so the future HTTP API and frontend reuse them, and moving to a remote transport later is a transport swap rather than a rewrite.

**Tech Stack:** Bun 1.3, TypeScript, Drizzle ORM 0.45 + `bun:sqlite`, `@modelcontextprotocol/sdk` 1.30, Zod 4, `bun:test`.

## Global Constraints

- **Money is always an integer in minor units (grosze).** Never floats, never decimals. Field names carry the `_minor` suffix.
- **Dates are integer Unix timestamps in seconds**, not text. Huntly stores `datetime('now')` strings; that is explicitly not carried over.
- **MCP tools never import `db` or Drizzle.** They import from `src/services/`. A tool that queries the database directly is a defect.
- **Tests run against a separate database file**, never the working one. Huntly's tests wipe tables in the live `huntly.db`; for financial data that is unacceptable.
- **The database file is never committed.** `*.db`, `*.db-wal`, `*.db-shm` are already in `.gitignore`.
- **Migrations are versioned files** produced by `drizzle-kit generate`, applied by a migrate script. Never `db:push` — Huntly has no migration history and its spending equivalent would be unrecoverable.
- **Category depth is unlimited.** No code may assume a fixed number of levels.
- **Zod 4 syntax.** Huntly uses Zod 3; `z.string().url()` is deprecated in favour of `z.url()`.
- **MCP registration uses `registerTool`.** The `server.tool()` form used in Huntly is deprecated in SDK 1.30.
- Package scope is `@paragon/*`.

## File Structure

```
package.json                              workspaces root
tsconfig.json                             shared compiler options
packages/shared/
  package.json
  src/index.ts                            barrel
  src/enums.ts                            TransactionType, Scope, Source as const arrays + types
  src/schemas/transaction.ts              Zod schemas for the write path
apps/server/
  package.json
  drizzle.config.ts
  src/db/schema.ts                        four tables
  src/db/index.ts                         Database + drizzle wiring, DB_PATH aware
  src/db/migrate.ts                       applies migrations from ./drizzle
  src/money.ts                            parseAmountToMinor, formatMinor
  src/services/dedup.ts                   normalizeMerchant, computeDedupHash
  src/services/categories.ts              listCategories → tree
  src/services/transactions.ts            addTransactions with invariant + dedup
  src/mcp/index.ts                        stdio server wiring
  src/mcp/tools/list-categories.ts        { def, handler }
  src/mcp/tools/add-transactions.ts       { def, handler }
  test/money.test.ts
  test/dedup.test.ts
  test/categories.test.ts
  test/transactions.test.ts
  test/helpers/db.ts                      test database lifecycle
```

Split rationale: `money.ts` and `services/dedup.ts` are pure functions with no database access, so they are tested without any fixture. `services/transactions.ts` owns every write invariant. MCP tools are thin adapters — argument shape in, formatted text out.

---

### Task 1: Monorepo skeleton and shared package

**Files:**
- Create: `package.json`, `tsconfig.json`, `packages/shared/package.json`, `packages/shared/src/enums.ts`, `packages/shared/src/index.ts`
- Test: `apps/server/test/money.test.ts` (added in Task 2 — this task has no test of its own)

**Interfaces:**
- Consumes: nothing.
- Produces: `@paragon/shared` exporting `TRANSACTION_TYPES`, `SCOPES`, `SOURCES` as readonly string arrays, and the types `TransactionType`, `Scope`, `Source`.

This task is scaffolding only. It carries no test cycle of its own; Task 2 is the first task whose deliverable is verifiable. It is separated because every later task imports from it.

- [ ] **Step 1: Create the workspace root**

`package.json`:

```json
{
  "name": "paragon",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "test": "bun test"
  }
}
```

Note: Huntly carries a `postinstall` symlink hack for workspace resolution. Do not copy it. Bun 1.3 resolves `workspace:*` correctly; if imports fail, fix the workspace config rather than adding a symlink.

- [ ] **Step 2: Create the root tsconfig**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "types": ["bun"]
  }
}
```

- [ ] **Step 3: Create the shared package manifest**

`packages/shared/package.json`:

```json
{
  "name": "@paragon/shared",
  "version": "0.0.1",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "zod": "^4.4.3"
  }
}
```

- [ ] **Step 4: Define the enums**

`packages/shared/src/enums.ts`:

```typescript
export const TRANSACTION_TYPES = ["expense", "income", "transfer"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const SCOPES = ["personal", "shared"] as const;
export type Scope = (typeof SCOPES)[number];

export const SOURCES = ["card", "cash", "transfer"] as const;
export type Source = (typeof SOURCES)[number];
```

- [ ] **Step 5: Create the barrel export**

`packages/shared/src/index.ts`:

```typescript
export * from "./enums";
```

- [ ] **Step 6: Install and verify resolution**

Run: `bun install`
Expected: completes without error.

Then verify the import actually resolves, from inside a workspace that depends on it:

```bash
cd apps/server && bun -e 'import { TRANSACTION_TYPES } from "@paragon/shared"; console.log(TRANSACTION_TYPES);'
```

Expected: prints `[ "expense", "income", "transfer" ]`.

Note: Bun 1.3 resolves workspace packages through `bun.lock` and does **not** create a
`node_modules/@paragon/` directory. Its absence is normal — do not add Huntly's `postinstall`
symlink. Only the import check above proves resolution works.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json packages/
git commit -m "feat: monorepo skeleton and shared enums"
```

---

### Task 2: Money handling

**Files:**
- Create: `apps/server/package.json`, `apps/server/src/money.ts`
- Test: `apps/server/test/money.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseAmountToMinor(value: string | number): number` and `formatMinor(minor: number): string` from `src/money.ts`.

Claude will send amounts read off receipts. Those arrive as `"184,20"`, `"184.20"` or `184.2`. Every one must become the integer `18420`. Floating-point arithmetic is not acceptable: `184.20 * 100` evaluates to `18419.999999999996`, which truncates to `18419` and loses a grosz — and with the line-sum invariant in Task 6, a lost grosz rejects the whole receipt.

- [ ] **Step 1: Create the server package manifest**

`apps/server/package.json`:

```json
{
  "name": "@paragon/server",
  "version": "0.0.1",
  "scripts": {
    "mcp": "bun run src/mcp/index.ts",
    "db:generate": "bunx drizzle-kit generate",
    "db:migrate": "bun run src/db/migrate.ts"
  },
  "dependencies": {
    "@paragon/shared": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.30.0",
    "drizzle-orm": "^0.45.2",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/bun": "^1.3.11",
    "drizzle-kit": "^0.31.10"
  }
}
```

Run `bun install` after creating this file.

- [ ] **Step 2: Write the failing test**

`apps/server/test/money.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { parseAmountToMinor, formatMinor } from "../src/money";

describe("parseAmountToMinor", () => {
  it("parses a dot decimal", () => {
    expect(parseAmountToMinor("184.20")).toBe(18420);
  });

  it("parses a comma decimal, as printed on Polish receipts", () => {
    expect(parseAmountToMinor("184,20")).toBe(18420);
  });

  it("parses a whole number without decimals", () => {
    expect(parseAmountToMinor("184")).toBe(18400);
  });

  it("parses a single decimal place", () => {
    expect(parseAmountToMinor("184.2")).toBe(18420);
  });

  it("accepts a JavaScript number", () => {
    expect(parseAmountToMinor(184.2)).toBe(18420);
  });

  it("does not lose a grosz to floating point", () => {
    // 184.20 * 100 === 18419.999999999996 in IEEE 754
    expect(parseAmountToMinor(184.2)).toBe(18420);
    expect(parseAmountToMinor("1.15")).toBe(115);
    expect(parseAmountToMinor("2.675")).toBe(268);
  });

  it("handles thousands separators", () => {
    expect(parseAmountToMinor("1 234,56")).toBe(123456);
    expect(parseAmountToMinor("1234.56")).toBe(123456);
  });

  it("handles negative amounts", () => {
    expect(parseAmountToMinor("-184,20")).toBe(-18420);
  });

  it("rejects a non-numeric string", () => {
    expect(() => parseAmountToMinor("abc")).toThrow();
  });

  it("rejects an empty string", () => {
    expect(() => parseAmountToMinor("")).toThrow();
  });
});

describe("formatMinor", () => {
  it("formats with two decimal places", () => {
    expect(formatMinor(18420)).toBe("184.20");
  });

  it("pads a single-digit remainder", () => {
    expect(formatMinor(18405)).toBe("184.05");
  });

  it("formats zero", () => {
    expect(formatMinor(0)).toBe("0.00");
  });

  it("formats a negative amount", () => {
    expect(formatMinor(-18420)).toBe("-184.20");
  });

  it("round-trips with parseAmountToMinor", () => {
    expect(parseAmountToMinor(formatMinor(18420))).toBe(18420);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test apps/server/test/money.test.ts`
Expected: FAIL — cannot resolve `../src/money`.

- [ ] **Step 4: Implement**

`apps/server/src/money.ts`:

```typescript
/**
 * Parses a human-written amount into an integer count of minor units (grosze).
 *
 * Works on the string representation rather than multiplying by 100, because
 * 184.20 * 100 evaluates to 18419.999999999996 under IEEE 754 and truncates
 * to a wrong value. Receipts arrive in both "184,20" and "184.20" forms.
 */
export function parseAmountToMinor(value: string | number): number {
  const raw = typeof value === "number" ? value.toString() : value.trim();
  if (raw === "") throw new Error("Amount is empty");

  const normalized = raw.replace(/[\s ]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Not a valid amount: ${value}`);
  }

  const negative = normalized.startsWith("-");
  const digits = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ""] = digits.split(".");

  // Pad or round the fractional part to exactly two digits.
  const twoDigits =
    fraction.length <= 2
      ? fraction.padEnd(2, "0")
      : String(Math.round(Number(`0.${fraction}`) * 100)).padStart(2, "0");

  const minor = Number(whole) * 100 + Number(twoDigits);
  return negative ? -minor : minor;
}

/** Renders minor units back as a decimal string with two places. */
export function formatMinor(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test apps/server/test/money.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/server/package.json apps/server/src/money.ts apps/server/test/money.test.ts
git commit -m "feat: integer money parsing and formatting"
```

---

### Task 3: Database schema and migrations

**Files:**
- Create: `apps/server/src/db/schema.ts`, `apps/server/src/db/index.ts`, `apps/server/src/db/migrate.ts`, `apps/server/drizzle.config.ts`, `apps/server/test/helpers/db.ts`
- Test: verified by running the migration; the first schema assertions arrive in Task 5

**Interfaces:**
- Consumes: `TRANSACTION_TYPES`, `SCOPES`, `SOURCES` from `@paragon/shared`.
- Produces: `db` from `src/db/index.ts`; the tables `categories`, `merchants`, `transactions`, `lineItems` from `src/db/schema.ts`; `resetTestDb()` from `test/helpers/db.ts`.

- [ ] **Step 1: Define the schema**

`apps/server/src/db/schema.ts`:

```typescript
import { sqliteTable, text, integer, index, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const categories = sqliteTable(
  "categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // Self-reference: unlimited depth. AnySQLiteColumn breaks the circular type.
    parentId: integer("parent_id").references((): AnySQLiteColumn => categories.id, {
      onDelete: "restrict",
    }),
    name: text("name").notNull(),
    // Default fixed/discretionary classification. Lines may override it.
    isFixed: integer("is_fixed", { mode: "boolean" }).notNull().default(false),
    // Archived categories vanish from pickers but stay in past reports.
    archivedAt: integer("archived_at"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => [index("categories_parent_idx").on(t.parentId)],
);

export const merchants = sqliteTable(
  "merchants",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    nameNorm: text("name_norm").notNull().unique(),
    defaultCategoryId: integer("default_category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    seenCount: integer("seen_count").notNull().default(0),
    lastSeenAt: integer("last_seen_at"),
  },
  (t) => [index("merchants_name_norm_idx").on(t.nameNorm)],
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // Unix seconds, not text. Period filters and monthly grouping need a real type.
    occurredOn: integer("occurred_on").notNull(),
    type: text("type").notNull(),
    totalMinor: integer("total_minor").notNull(),
    currency: text("currency").notNull().default("PLN"),
    // Rate against PLN, pinned to the transaction date, in millionths to stay integral.
    fxRate: integer("fx_rate"),
    merchantRaw: text("merchant_raw"),
    merchantId: integer("merchant_id").references(() => merchants.id, { onDelete: "set null" }),
    payer: text("payer"),
    scope: text("scope"),
    account: text("account"),
    note: text("note"),
    dedupHash: text("dedup_hash").notNull(),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex("transactions_dedup_hash_idx").on(t.dedupHash),
    index("transactions_occurred_on_idx").on(t.occurredOn),
    index("transactions_merchant_idx").on(t.merchantId),
  ],
);

export const lineItems = sqliteTable(
  "line_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    transactionId: integer("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    amountMinor: integer("amount_minor").notNull(),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "restrict" }),
    // NULL means "inherit from the category"; true/false overrides it.
    isFixedOverride: integer("is_fixed_override", { mode: "boolean" }),
    note: text("note"),
  },
  (t) => [
    index("line_items_transaction_idx").on(t.transactionId),
    index("line_items_category_idx").on(t.categoryId),
  ],
);
```

Note on `fxRate`: stored as an integer in millionths (a rate of 4.33 is `4330000`) so no float ever reaches the database. It is nullable — PLN-to-PLN transactions do not need one.

- [ ] **Step 2: Wire up the database connection**

`apps/server/src/db/index.ts`:

```typescript
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import * as schema from "./schema";

// Tests point DB_PATH at a scratch file. Never let a test touch the real data.
const dbPath = process.env.DB_PATH ?? "paragon.db";

const sqlite = new Database(dbPath);
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

export const db = drizzle({ client: sqlite, schema });
export { sqlite };
```

- [ ] **Step 3: Create the Drizzle config**

`apps/server/drizzle.config.ts`:

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "sqlite",
  dbCredentials: { url: process.env.DB_PATH ?? "paragon.db" },
});
```

- [ ] **Step 4: Write the migration runner**

`apps/server/src/db/migrate.ts`:

```typescript
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { db } from "./index";

migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations applied.");
```

- [ ] **Step 5: Generate the migration**

Run: `cd apps/server && bun run db:generate`
Expected: a `drizzle/0000_*.sql` file appears containing four `CREATE TABLE` statements.

Read the generated SQL and confirm it contains `CREATE UNIQUE INDEX` on `dedup_hash`. If it does not, the schema is wrong — fix it before continuing, because Task 6 depends on the database rejecting duplicates.

- [ ] **Step 6: Apply the migration**

Run: `cd apps/server && bun run db:migrate`
Expected: prints `Migrations applied.` and creates `paragon.db`.

- [ ] **Step 7: Write the test database helper**

`apps/server/test/helpers/db.ts`:

```typescript
import { unlinkSync, existsSync } from "node:fs";

// Must be set before any import of src/db, which reads it at module load.
const TEST_DB = "paragon.test.db";
process.env.DB_PATH = TEST_DB;

for (const suffix of ["", "-wal", "-shm"]) {
  const file = `${TEST_DB}${suffix}`;
  if (existsSync(file)) unlinkSync(file);
}

const { migrate } = await import("drizzle-orm/bun-sqlite/migrator");
const { db } = await import("../../src/db");
const schema = await import("../../src/db/schema");

migrate(db, { migrationsFolder: "./drizzle" });

/** Clears every table. Call in beforeEach. */
export function resetTestDb() {
  db.delete(schema.lineItems).run();
  db.delete(schema.transactions).run();
  db.delete(schema.merchants).run();
  db.delete(schema.categories).run();
}

export { db, schema };
```

Huntly's tests wipe tables in the live `huntly.db`. This helper exists so that never happens here — deleting a spending history is not recoverable.

- [ ] **Step 8: Verify the helper builds a clean database**

Run: `cd apps/server && bun test test/helpers/db.ts`
Expected: no tests found, but no errors — the file imports and migrates cleanly. Confirm `paragon.test.db` was created.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/db apps/server/drizzle.config.ts apps/server/drizzle apps/server/test/helpers
git commit -m "feat: database schema and migrations"
```

---

### Task 4: Merchant normalization and deduplication hash

**Files:**
- Create: `apps/server/src/services/dedup.ts`
- Test: `apps/server/test/dedup.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizeMerchant(raw: string): string` and `computeDedupHash(input: { occurredOn: number; totalMinor: number; merchantNorm: string }): string` from `src/services/dedup.ts`.

The same receipt will arrive twice — once photographed, later inside a bank statement. The bank writes `ZABKA NANO Z1234 WARSZAWA`, the receipt says `Żabka`. Normalization has to collapse both to the same key, otherwise the duplicate slips through.

- [ ] **Step 1: Write the failing test**

`apps/server/test/dedup.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { normalizeMerchant, computeDedupHash } from "../src/services/dedup";

describe("normalizeMerchant", () => {
  it("lowercases", () => {
    expect(normalizeMerchant("BIEDRONKA")).toBe("biedronka");
  });

  it("strips Polish diacritics so bank and receipt spellings agree", () => {
    expect(normalizeMerchant("Żabka")).toBe("zabka");
    expect(normalizeMerchant("ŻABKA")).toBe("zabka");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeMerchant("Lidl   sp.  z o.o.")).toBe("lidl sp z oo");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeMerchant("  Orlen  ")).toBe("orlen");
  });

  it("drops punctuation", () => {
    expect(normalizeMerchant("Sp. z o.o.")).toBe("sp z oo");
  });

  it("removes terminal reference numbers a bank appends", () => {
    expect(normalizeMerchant("ZABKA NANO Z1234")).toBe("zabka nano");
  });

  it("keeps digits that are part of the name", () => {
    expect(normalizeMerchant("Circle K 24")).toBe("circle k 24");
  });

  it("returns an empty string for empty input", () => {
    expect(normalizeMerchant("")).toBe("");
    expect(normalizeMerchant("   ")).toBe("");
  });
});

describe("computeDedupHash", () => {
  const base = { occurredOn: 1786230000, totalMinor: 18420, merchantNorm: "biedronka" };

  it("is stable across calls", () => {
    expect(computeDedupHash(base)).toBe(computeDedupHash(base));
  });

  it("changes when the amount changes", () => {
    expect(computeDedupHash(base)).not.toBe(computeDedupHash({ ...base, totalMinor: 18421 }));
  });

  it("changes when the date changes", () => {
    expect(computeDedupHash(base)).not.toBe(computeDedupHash({ ...base, occurredOn: 1786316400 }));
  });

  it("changes when the merchant changes", () => {
    expect(computeDedupHash(base)).not.toBe(computeDedupHash({ ...base, merchantNorm: "zabka" }));
  });

  it("returns a hex digest", () => {
    expect(computeDedupHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && bun test test/dedup.test.ts`
Expected: FAIL — cannot resolve `../src/services/dedup`.

- [ ] **Step 3: Implement**

`apps/server/src/services/dedup.ts`:

```typescript
import { createHash } from "node:crypto";

/**
 * Reduces a merchant name to a stable key.
 *
 * The same shop reaches us spelled differently: a receipt says "Żabka", the PKO
 * statement says "ZABKA NANO Z1234 WARSZAWA". Both must collapse to one key or
 * deduplication silently fails and the expense is counted twice.
 */
export function normalizeMerchant(raw: string): string {
  return raw
    .normalize("NFD")
    // Strip combining marks: ż → z, ó → o, ł is handled separately below.
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/gi, "l")
    .toLowerCase()
    // Drop terminal reference codes: a letter followed by 3+ digits at the end.
    .replace(/\s+[a-z]?\d{3,}\s*$/i, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fingerprint of a transaction: same day, same amount, same merchant.
 *
 * Backed by a unique index, so a repeat submission is rejected by the database
 * rather than relying on a prior read.
 */
export function computeDedupHash(input: {
  occurredOn: number;
  totalMinor: number;
  merchantNorm: string;
}): string {
  return createHash("sha256")
    .update(`${input.occurredOn}|${input.totalMinor}|${input.merchantNorm}`)
    .digest("hex");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/server && bun test test/dedup.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/dedup.ts apps/server/test/dedup.test.ts
git commit -m "feat: merchant normalization and dedup hashing"
```

---

### Task 5: Category service

**Files:**
- Create: `apps/server/src/services/categories.ts`
- Test: `apps/server/test/categories.test.ts`

**Interfaces:**
- Consumes: `db` and `categories` from `src/db`; `resetTestDb`, `db`, `schema` from `test/helpers/db` (test only).
- Produces: from `src/services/categories.ts`:
  - `type CategoryNode = { id: number; name: string; isFixed: boolean; children: CategoryNode[] }`
  - `listCategories(): CategoryNode[]` — archived categories excluded
  - `createCategory(input: { name: string; parentId?: number | null; isFixed?: boolean }): { id: number; name: string }`
  - `findCategoryByPath(path: string): number | null` — resolves `"Food/Groceries"` to an id

`findCategoryByPath` exists because Claude names categories rather than knowing their ids. Depth is unlimited, so resolution walks the path segment by segment.

- [ ] **Step 1: Write the failing test**

`apps/server/test/categories.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { resetTestDb, db, schema } from "./helpers/db";
import { listCategories, createCategory, findCategoryByPath } from "../src/services/categories";

beforeEach(() => {
  resetTestDb();
});

describe("createCategory", () => {
  it("creates a root category", () => {
    const cat = createCategory({ name: "Food" });
    expect(cat.id).toBeGreaterThan(0);
    expect(cat.name).toBe("Food");
  });

  it("creates a child category", () => {
    const parent = createCategory({ name: "Food" });
    const child = createCategory({ name: "Groceries", parentId: parent.id });
    expect(child.id).not.toBe(parent.id);
  });

  it("records the fixed flag", () => {
    createCategory({ name: "Rent", isFixed: true });
    const tree = listCategories();
    expect(tree.find((c) => c.name === "Rent")?.isFixed).toBe(true);
  });

  it("defaults the fixed flag to false", () => {
    createCategory({ name: "Coffee" });
    const tree = listCategories();
    expect(tree.find((c) => c.name === "Coffee")?.isFixed).toBe(false);
  });
});

describe("listCategories", () => {
  it("returns an empty array when there are none", () => {
    expect(listCategories()).toEqual([]);
  });

  it("nests children under their parent", () => {
    const food = createCategory({ name: "Food" });
    createCategory({ name: "Groceries", parentId: food.id });
    createCategory({ name: "Restaurants", parentId: food.id });

    const tree = listCategories();
    expect(tree).toHaveLength(1);
    expect(tree[0]!.name).toBe("Food");
    expect(tree[0]!.children.map((c) => c.name).sort()).toEqual(["Groceries", "Restaurants"]);
  });

  it("nests to four levels, since depth is unlimited", () => {
    const l1 = createCategory({ name: "Home" });
    const l2 = createCategory({ name: "Household", parentId: l1.id });
    const l3 = createCategory({ name: "Cleaning", parentId: l2.id });
    createCategory({ name: "Detergent", parentId: l3.id });

    const tree = listCategories();
    expect(tree[0]!.children[0]!.children[0]!.children[0]!.name).toBe("Detergent");
  });

  it("excludes archived categories", () => {
    const food = createCategory({ name: "Food" });
    createCategory({ name: "Obsolete", parentId: food.id });
    db.update(schema.categories)
      .set({ archivedAt: 1786230000 })
      .where(eq(schema.categories.name, "Obsolete"))
      .run();

    const tree = listCategories();
    expect(tree[0]!.children).toHaveLength(0);
  });
});

describe("findCategoryByPath", () => {
  it("resolves a root category by name", () => {
    const food = createCategory({ name: "Food" });
    expect(findCategoryByPath("Food")).toBe(food.id);
  });

  it("resolves a nested path", () => {
    const food = createCategory({ name: "Food" });
    const groceries = createCategory({ name: "Groceries", parentId: food.id });
    expect(findCategoryByPath("Food/Groceries")).toBe(groceries.id);
  });

  it("is case-insensitive", () => {
    const food = createCategory({ name: "Food" });
    expect(findCategoryByPath("food")).toBe(food.id);
  });

  it("returns null for an unknown path", () => {
    expect(findCategoryByPath("Nonexistent")).toBeNull();
  });

  it("returns null when an intermediate segment is missing", () => {
    createCategory({ name: "Food" });
    expect(findCategoryByPath("Food/Missing/Deeper")).toBeNull();
  });

  it("does not match a child as if it were a root", () => {
    const food = createCategory({ name: "Food" });
    createCategory({ name: "Groceries", parentId: food.id });
    expect(findCategoryByPath("Groceries")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && bun test test/categories.test.ts`
Expected: FAIL — cannot resolve `../src/services/categories`.

- [ ] **Step 3: Implement**

`apps/server/src/services/categories.ts`:

```typescript
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
  const segments = path.split("/").map((s) => s.trim()).filter(Boolean);
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/server && bun test test/categories.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/categories.ts apps/server/test/categories.test.ts
git commit -m "feat: category service with unlimited-depth tree"
```

---

### Task 6: Transaction service — the invariant and deduplication

**Files:**
- Create: `apps/server/src/services/transactions.ts`, `packages/shared/src/schemas/transaction.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `apps/server/test/transactions.test.ts`

**Interfaces:**
- Consumes: `db`, tables from `src/db/schema`, `parseAmountToMinor` from `src/money`, `normalizeMerchant` and `computeDedupHash` from `src/services/dedup`, `findCategoryByPath` and `createCategory` from `src/services/categories`.
- Produces: from `src/services/transactions.ts`:
  - `type AddTransactionInput` and `type AddResult = { status: "created"; id: number } | { status: "already_exists"; id: number }`
  - `addTransactions(items: AddTransactionInput[]): AddResult[]`
- Also produces `addTransactionSchema` from `@paragon/shared`.

This is the task that carries both write invariants. The sum of line items must equal the transaction total, and a repeated receipt must return `already_exists` rather than inserting a second row.

- [ ] **Step 1: Write the shared Zod schema**

`packages/shared/src/schemas/transaction.ts`:

```typescript
import { z } from "zod";
import { TRANSACTION_TYPES, SCOPES, SOURCES } from "../enums";

export const lineItemSchema = z.object({
  amount: z.union([z.string(), z.number()]).describe("Line amount, e.g. \"124.30\" or \"124,30\""),
  category: z.string().describe("Category path, e.g. \"Food/Groceries\""),
  note: z.string().optional(),
});

export const addTransactionSchema = z.object({
  date: z.string().describe("Transaction date, YYYY-MM-DD"),
  total: z.union([z.string(), z.number()]).describe("Total amount as printed on the receipt"),
  type: z.enum(TRANSACTION_TYPES).default("expense"),
  currency: z.string().length(3).default("PLN"),
  fxRate: z.number().optional().describe("Rate against PLN on that date, e.g. 4.33"),
  merchant: z.string().optional().describe("Merchant name as printed"),
  payer: z.string().optional(),
  scope: z.enum(SCOPES).optional(),
  source: z.enum(SOURCES).optional(),
  account: z.string().optional(),
  note: z.string().optional(),
  lineItems: z.array(lineItemSchema).optional()
    .describe("Receipt breakdown. Omit for a single-category expense."),
});

export type AddTransactionInput = z.infer<typeof addTransactionSchema>;
```

Update `packages/shared/src/index.ts`:

```typescript
export * from "./enums";
export * from "./schemas/transaction";
```

- [ ] **Step 2: Write the failing test**

`apps/server/test/transactions.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from "bun:test";
import { resetTestDb, db, schema } from "./helpers/db";
import { addTransactions } from "../src/services/transactions";
import { createCategory } from "../src/services/categories";

beforeEach(() => {
  resetTestDb();
});

function seedCategories() {
  const food = createCategory({ name: "Food" });
  const groceries = createCategory({ name: "Groceries", parentId: food.id });
  const home = createCategory({ name: "Home" });
  createCategory({ name: "Cleaning", parentId: home.id });
  return { food, groceries, home };
}

describe("addTransactions", () => {
  it("creates a transaction with one implicit line when none are given", () => {
    seedCategories();
    const [result] = addTransactions([
      { date: "2026-08-09", total: "23.50", merchant: "Żabka", lineItems: [{ amount: "23.50", category: "Food/Groceries" }] },
    ]);

    expect(result!.status).toBe("created");
    const lines = db.select().from(schema.lineItems).all();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.amountMinor).toBe(2350);
  });

  it("splits a receipt across several categories", () => {
    seedCategories();
    const [result] = addTransactions([
      {
        date: "2026-08-09",
        total: "184.20",
        merchant: "Biedronka",
        lineItems: [
          { amount: "124.30", category: "Food/Groceries" },
          { amount: "38.00", category: "Home/Cleaning" },
          { amount: "21.90", category: "Food/Groceries", note: "wine" },
        ],
      },
    ]);

    expect(result!.status).toBe("created");
    const lines = db.select().from(schema.lineItems).all();
    expect(lines).toHaveLength(3);
    expect(lines.reduce((sum, l) => sum + l.amountMinor, 0)).toBe(18420);
  });

  it("rejects a receipt whose lines do not sum to the total", () => {
    seedCategories();
    expect(() =>
      addTransactions([
        {
          date: "2026-08-09",
          total: "184.20",
          merchant: "Biedronka",
          lineItems: [
            { amount: "124.30", category: "Food/Groceries" },
            { amount: "38.00", category: "Home/Cleaning" },
          ],
        },
      ]),
    ).toThrow(/does not match/i);
  });

  it("writes nothing when the invariant fails", () => {
    seedCategories();
    try {
      addTransactions([
        { date: "2026-08-09", total: "100.00", merchant: "Test", lineItems: [{ amount: "50.00", category: "Food/Groceries" }] },
      ]);
    } catch {
      // expected
    }
    expect(db.select().from(schema.transactions).all()).toHaveLength(0);
    expect(db.select().from(schema.lineItems).all()).toHaveLength(0);
  });

  it("returns already_exists for the same receipt sent twice", () => {
    seedCategories();
    const item = {
      date: "2026-08-09",
      total: "23.50",
      merchant: "Żabka",
      lineItems: [{ amount: "23.50", category: "Food/Groceries" }],
    };

    const [first] = addTransactions([item]);
    const [second] = addTransactions([item]);

    expect(first!.status).toBe("created");
    expect(second!.status).toBe("already_exists");
    expect(second!.id).toBe(first!.id);
    expect(db.select().from(schema.transactions).all()).toHaveLength(1);
  });

  it("treats the bank spelling of a merchant as the same transaction", () => {
    seedCategories();
    addTransactions([
      { date: "2026-08-09", total: "23.50", merchant: "Żabka", lineItems: [{ amount: "23.50", category: "Food/Groceries" }] },
    ]);
    const [second] = addTransactions([
      { date: "2026-08-09", total: "23.50", merchant: "ZABKA", lineItems: [{ amount: "23.50", category: "Food/Groceries" }] },
    ]);

    expect(second!.status).toBe("already_exists");
  });

  it("does not deduplicate two genuinely different amounts on one day", () => {
    seedCategories();
    addTransactions([
      { date: "2026-08-09", total: "23.50", merchant: "Żabka", lineItems: [{ amount: "23.50", category: "Food/Groceries" }] },
    ]);
    const [second] = addTransactions([
      { date: "2026-08-09", total: "17.90", merchant: "Żabka", lineItems: [{ amount: "17.90", category: "Food/Groceries" }] },
    ]);

    expect(second!.status).toBe("created");
    expect(db.select().from(schema.transactions).all()).toHaveLength(2);
  });

  it("creates a merchant row and counts sightings", () => {
    seedCategories();
    addTransactions([
      { date: "2026-08-09", total: "23.50", merchant: "Żabka", lineItems: [{ amount: "23.50", category: "Food/Groceries" }] },
    ]);
    addTransactions([
      { date: "2026-08-10", total: "17.90", merchant: "Żabka", lineItems: [{ amount: "17.90", category: "Food/Groceries" }] },
    ]);

    const merchants = db.select().from(schema.merchants).all();
    expect(merchants).toHaveLength(1);
    expect(merchants[0]!.nameNorm).toBe("zabka");
    expect(merchants[0]!.seenCount).toBe(2);
  });

  it("keeps the raw merchant string alongside the normalized one", () => {
    seedCategories();
    addTransactions([
      { date: "2026-08-09", total: "23.50", merchant: "ZABKA NANO Z1234", lineItems: [{ amount: "23.50", category: "Food/Groceries" }] },
    ]);

    const tx = db.select().from(schema.transactions).all()[0]!;
    expect(tx.merchantRaw).toBe("ZABKA NANO Z1234");
  });

  it("stores the date as a Unix timestamp", () => {
    seedCategories();
    addTransactions([
      { date: "2026-08-09", total: "23.50", merchant: "Żabka", lineItems: [{ amount: "23.50", category: "Food/Groceries" }] },
    ]);

    const tx = db.select().from(schema.transactions).all()[0]!;
    expect(typeof tx.occurredOn).toBe("number");
    expect(tx.occurredOn).toBe(Math.floor(Date.UTC(2026, 7, 9) / 1000));
  });

  it("stores fxRate as an integer in millionths", () => {
    seedCategories();
    addTransactions([
      {
        date: "2026-08-05",
        total: "2400.00",
        type: "income",
        currency: "EUR",
        fxRate: 4.33,
        merchant: "Salary",
        lineItems: [{ amount: "2400.00", category: "Food/Groceries" }],
      },
    ]);

    const tx = db.select().from(schema.transactions).all()[0]!;
    expect(tx.fxRate).toBe(4330000);
    expect(tx.currency).toBe("EUR");
  });

  it("processes a batch of several receipts", () => {
    seedCategories();
    const results = addTransactions([
      { date: "2026-08-09", total: "23.50", merchant: "Żabka", lineItems: [{ amount: "23.50", category: "Food/Groceries" }] },
      { date: "2026-08-08", total: "310.00", merchant: "Orlen", lineItems: [{ amount: "310.00", category: "Food/Groceries" }] },
    ]);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "created")).toBe(true);
    expect(db.select().from(schema.transactions).all()).toHaveLength(2);
  });

  it("rejects an unknown category path", () => {
    seedCategories();
    expect(() =>
      addTransactions([
        { date: "2026-08-09", total: "23.50", merchant: "Żabka", lineItems: [{ amount: "23.50", category: "Nonexistent/Path" }] },
      ]),
    ).toThrow(/category/i);
  });

  it("defaults the type to expense", () => {
    seedCategories();
    addTransactions([
      { date: "2026-08-09", total: "23.50", merchant: "Żabka", lineItems: [{ amount: "23.50", category: "Food/Groceries" }] },
    ]);

    const tx = db.select().from(schema.transactions).all()[0]!;
    expect(tx.type).toBe("expense");
  });

  it("records a transfer without touching merchants", () => {
    seedCategories();
    addTransactions([
      {
        date: "2026-08-08",
        total: "1500.00",
        type: "transfer",
        note: "to savings",
        lineItems: [{ amount: "1500.00", category: "Food/Groceries" }],
      },
    ]);

    const tx = db.select().from(schema.transactions).all()[0]!;
    expect(tx.type).toBe("transfer");
    expect(db.select().from(schema.merchants).all()).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/server && bun test test/transactions.test.ts`
Expected: FAIL — cannot resolve `../src/services/transactions`.

- [ ] **Step 4: Implement**

`apps/server/src/services/transactions.ts`:

```typescript
import { eq, sql } from "drizzle-orm";
import type { AddTransactionInput } from "@paragon/shared";
import { db } from "../db";
import { transactions, lineItems, merchants } from "../db/schema";
import { parseAmountToMinor } from "../money";
import { normalizeMerchant, computeDedupHash } from "./dedup";
import { findCategoryByPath } from "./categories";

export type { AddTransactionInput };

export type AddResult =
  | { status: "created"; id: number }
  | { status: "already_exists"; id: number };

/** Converts YYYY-MM-DD to Unix seconds at UTC midnight. */
function parseDate(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) throw new Error(`Invalid date, expected YYYY-MM-DD: ${date}`);
  const [, y, m, d] = match;
  return Math.floor(Date.UTC(Number(y), Number(m) - 1, Number(d)) / 1000);
}

/** Finds or creates the merchant row and bumps its sighting counter. */
function upsertMerchant(nameNorm: string, occurredOn: number): number {
  const existing = db.select().from(merchants).where(eq(merchants.nameNorm, nameNorm)).get();

  if (existing) {
    db.update(merchants)
      .set({
        seenCount: existing.seenCount + 1,
        lastSeenAt: Math.max(existing.lastSeenAt ?? 0, occurredOn),
      })
      .where(eq(merchants.id, existing.id))
      .run();
    return existing.id;
  }

  return db
    .insert(merchants)
    .values({ nameNorm, seenCount: 1, lastSeenAt: occurredOn })
    .returning({ id: merchants.id })
    .get().id;
}

/**
 * Writes transactions with their receipt lines.
 *
 * Two invariants hold here rather than at the call site, so the MCP tools, the
 * future HTTP API and the frontend cannot diverge:
 *   1. the line amounts must sum to the transaction total;
 *   2. a repeat of the same receipt returns already_exists instead of inserting.
 */
export function addTransactions(items: AddTransactionInput[]): AddResult[] {
  return items.map((item) => addOne(item));
}

function addOne(item: AddTransactionInput): AddResult {
  const occurredOn = parseDate(item.date);
  const totalMinor = parseAmountToMinor(item.total);

  const lines = item.lineItems?.length
    ? item.lineItems
    : [{ amount: item.total, category: "", note: undefined }];

  // Resolve categories before opening the transaction so a bad path fails cleanly.
  const resolved = lines.map((line) => {
    const amountMinor = parseAmountToMinor(line.amount);
    if (!line.category) {
      throw new Error("Every line item needs a category path");
    }
    const categoryId = findCategoryByPath(line.category);
    if (categoryId === null) {
      throw new Error(`Unknown category path: ${line.category}`);
    }
    return { amountMinor, categoryId, note: line.note ?? null };
  });

  const sum = resolved.reduce((acc, line) => acc + line.amountMinor, 0);
  if (sum !== totalMinor) {
    throw new Error(
      `Line items sum (${sum}) does not match the total (${totalMinor}). ` +
        `Difference: ${totalMinor - sum} minor units.`,
    );
  }

  const merchantRaw = item.merchant ?? null;
  const merchantNorm = merchantRaw ? normalizeMerchant(merchantRaw) : "";
  const dedupHash = computeDedupHash({ occurredOn, totalMinor, merchantNorm });

  const existing = db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.dedupHash, dedupHash))
    .get();

  if (existing) return { status: "already_exists", id: existing.id };

  // Everything below is one unit of work: a failed line write must not leave a
  // transaction row behind.
  return db.transaction((tx) => {
    // Transfers are movements between own accounts and have no merchant.
    const merchantId =
      merchantNorm && item.type !== "transfer" ? upsertMerchant(merchantNorm, occurredOn) : null;

    const inserted = tx
      .insert(transactions)
      .values({
        occurredOn,
        type: item.type ?? "expense",
        totalMinor,
        currency: item.currency ?? "PLN",
        // Millionths keeps the rate integral: 4.33 becomes 4330000.
        fxRate: item.fxRate === undefined ? null : Math.round(item.fxRate * 1_000_000),
        merchantRaw,
        merchantId,
        payer: item.payer ?? null,
        scope: item.scope ?? null,
        account: item.account ?? null,
        note: item.note ?? null,
        dedupHash,
      })
      .returning({ id: transactions.id })
      .get();

    for (const line of resolved) {
      tx.insert(lineItems)
        .values({
          transactionId: inserted.id,
          amountMinor: line.amountMinor,
          categoryId: line.categoryId,
          note: line.note,
        })
        .run();
    }

    return { status: "created" as const, id: inserted.id };
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/server && bun test test/transactions.test.ts`
Expected: PASS, 15 tests.

If the "writes nothing when the invariant fails" test fails with a leftover row, the sum check has been placed inside the database transaction instead of before it. Move it out.

- [ ] **Step 6: Run the whole suite**

Run: `cd apps/server && bun test`
Expected: PASS — all four test files, 57 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/services/transactions.ts apps/server/test/transactions.test.ts packages/shared/src
git commit -m "feat: transaction service with line-sum invariant and dedup"
```

---

### Task 7: MCP tools and stdio server

**Files:**
- Create: `apps/server/src/mcp/tools/list-categories.ts`, `apps/server/src/mcp/tools/add-transactions.ts`, `apps/server/src/mcp/index.ts`
- Test: manual verification against a real Claude session (an automated test would only exercise the services already covered)

**Interfaces:**
- Consumes: `listCategories` from `src/services/categories`, `addTransactions` from `src/services/transactions`, `formatMinor` from `src/money`.
- Produces: a runnable MCP server at `apps/server/src/mcp/index.ts`.

These tools are adapters. They must not import `db` — every read and write goes through the services.

Note on the SDK: Huntly calls `server.tool(name, description, schema, handler)`. That overload is deprecated in SDK 1.30. Use `registerTool(name, config, handler)`.

- [ ] **Step 1: Write the list_categories tool**

`apps/server/src/mcp/tools/list-categories.ts`:

```typescript
import { listCategories, type CategoryNode } from "../../services/categories";

export const def = {
  name: "list_categories",
  config: {
    title: "List categories",
    description:
      "Returns the current category tree as indented paths. Call this before recording expenses so that categories match the existing taxonomy instead of inventing new names. Paths are slash-separated, e.g. Food/Groceries.",
    inputSchema: undefined,
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
```

- [ ] **Step 2: Write the add_transactions tool**

`apps/server/src/mcp/tools/add-transactions.ts`:

```typescript
import { z } from "zod";
import { addTransactionSchema } from "@paragon/shared";
import { addTransactions } from "../../services/transactions";
import { formatMinor, parseAmountToMinor } from "../../money";

export const def = {
  name: "add_transactions",
  config: {
    title: "Add transactions",
    description:
      "Records one or more transactions read from receipts, push notifications or a bank statement. " +
      "Call list_categories first so category paths match the existing tree. " +
      "Line item amounts must sum exactly to the transaction total; when a receipt covers several " +
      "categories, split it into a line per category. Sending the same receipt twice is safe — " +
      "the duplicate is reported rather than recorded again.",
    inputSchema: {
      items: z.array(addTransactionSchema).describe("Transactions to record"),
    },
  },
};

export async function handler(input: { items: z.infer<typeof addTransactionSchema>[] }) {
  try {
    const results = addTransactions(input.items);

    const lines = results.map((result, i) => {
      const item = input.items[i]!;
      const label = `${item.date} ${item.merchant ?? "(no merchant)"} ${formatMinor(
        parseAmountToMinor(item.total),
      )} ${item.currency ?? "PLN"}`;
      return result.status === "created"
        ? `Recorded #${result.id}: ${label}`
        : `Already recorded (#${result.id}): ${label}`;
    });

    const created = results.filter((r) => r.status === "created").length;
    const skipped = results.length - created;

    return {
      content: [
        {
          type: "text" as const,
          text: `${lines.join("\n")}\n\n${created} recorded${skipped ? `, ${skipped} already present` : ""}.`,
        },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Could not record: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}
```

- [ ] **Step 3: Wire the stdio server**

`apps/server/src/mcp/index.ts`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { def as listCategoriesDef, handler as listCategoriesHandler } from "./tools/list-categories";
import { def as addTransactionsDef, handler as addTransactionsHandler } from "./tools/add-transactions";

const server = new McpServer({ name: "paragon", version: "0.0.1" });

server.registerTool(listCategoriesDef.name, listCategoriesDef.config, listCategoriesHandler);
server.registerTool(addTransactionsDef.name, addTransactionsDef.config, addTransactionsHandler);

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 4: Verify the server starts**

Run: `cd apps/server && timeout 3 bun run src/mcp/index.ts < /dev/null; echo "exit=$?"`
Expected: no output on stdout, exit 124 (the timeout fired, meaning the server was waiting for input rather than crashing). Any stack trace means a broken import.

- [ ] **Step 5: Seed a starter category tree**

Run from `apps/server`:

```bash
bun -e '
import { createCategory } from "./src/services/categories";
const food = createCategory({ name: "Food" });
createCategory({ name: "Groceries", parentId: food.id });
createCategory({ name: "Restaurants", parentId: food.id });
const home = createCategory({ name: "Home" });
createCategory({ name: "Rent", parentId: home.id, isFixed: true });
createCategory({ name: "Utilities", parentId: home.id, isFixed: true });
createCategory({ name: "Cleaning", parentId: home.id });
createCategory({ name: "Transport" });
createCategory({ name: "Income" });
console.log("Seeded.");
'
```

Expected: prints `Seeded.`

- [ ] **Step 6: Register the server with Claude Code**

Run from the repository root:

```bash
claude mcp add paragon -- bun run --cwd /home/yahor/projects/paragon/apps/server src/mcp/index.ts
```

Confirm with `claude mcp list` that `paragon` appears.

- [ ] **Step 7: Verify end to end**

In a Claude session, send a receipt photo and ask for it to be recorded. Confirm:

1. `list_categories` is called and returns the seeded tree.
2. `add_transactions` writes the rows.
3. Sending the same receipt again reports it as already present.

Check the database directly:

```bash
cd apps/server && bun -e '
import { db } from "./src/db";
import { transactions, lineItems } from "./src/db/schema";
console.log(db.select().from(transactions).all());
console.log(db.select().from(lineItems).all());
'
```

Expected: one transaction, its lines summing to the total.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/mcp
git commit -m "feat: MCP stdio server with list_categories and add_transactions"
```

---

## Definition of Done

- `bun test` passes from the repository root.
- A receipt photo sent in a Claude chat becomes a transaction with correctly split lines.
- Sending the same receipt twice reports `already_exists` and leaves one row.
- A receipt whose lines do not sum to the total is rejected with the difference stated, and nothing is written.
- No `.db` file is tracked by git.
- No MCP tool imports `db`.

## Deferred to Phase 2

`get_merchant` (returning the default category for a known merchant) is deliberately absent. This phase populates the `merchants` table and counts sightings, but reading the memory back is Phase 2 work — it needs data before it is worth anything.

Also deferred: `search_transactions`, `get_summary`, `update_transaction`, `delete_transaction`, `create_category` as a tool, `update_category`, `reassign_line_items`, and the entire frontend.
