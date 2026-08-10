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
    // Recurs every month at a steady amount: rent, utilities, subscriptions.
    // Lines may override it.
    isFixed: integer("is_fixed", { mode: "boolean" }).notNull().default(false),
    // Occasional and lumpy: a holiday, a laptop. Kept out of the living-cost average
    // because averaging a trip in would raise it for three months afterwards and
    // shrink the payday figure to match. Distinct from isFixed, which is about
    // predictability rather than rarity — rent is fixed but not occasional.
    isOccasional: integer("is_occasional", { mode: "boolean" }).notNull().default(false),
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
