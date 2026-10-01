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
    // Where the money came from and went, when it is somewhere tracked. All four are
    // usually null: a purchase names nothing, because everyday cards are deliberately
    // not tracked — a card balance would disagree with reality by lunchtime, and a
    // reconciliation warning that is always on is one nobody reads. Accounts and
    // holdings get separate columns rather than a (kind, id) pair so the foreign keys
    // survive.
    fromAccountId: integer("from_account_id").references(() => accounts.id, {
      onDelete: "restrict",
    }),
    toAccountId: integer("to_account_id").references(() => accounts.id, {
      onDelete: "restrict",
    }),
    fromHoldingId: integer("from_holding_id").references(() => holdings.id, {
      onDelete: "restrict",
    }),
    toHoldingId: integer("to_holding_id").references(() => holdings.id, {
      onDelete: "restrict",
    }),
    note: text("note"),
    // Whether this income opens a new pay period. Only a paycheque does. Money that
    // was earned earlier and merely surfaced now — a gift spent on a trip, a refund,
    // a deposit coming back — is income all the same, but starting a period on it
    // splits the month in two and reports the paycheque as if it had never arrived.
    // Ignored for expenses and transfers.
    startsPeriod: integer("starts_period", { mode: "boolean" }).notNull().default(true),
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
    // What was bought, as printed on the receipt. Distinct from `note`, which is a
    // remark about the purchase ("подарок на годовщину") rather than its name.
    name: text("name"),
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

/**
 * Where money sits: savings accounts, cash, a foreign-currency balance.
 *
 * Everyday cards are deliberately absent. Their balance would diverge from reality
 * within a day of ordinary spending, and an account that never reconciles teaches the
 * reader to ignore the warning that says so.
 */
export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("PLN"),
  // What the bank says today. Typed in rather than derived: the application sees only
  // the movements it was told about, and this is the truth they are checked against.
  balanceMinor: integer("balance_minor").notNull().default(0),
  // The balance on the day this account entered the application. Reconciliation counts
  // movements forward from here; without it there is nothing to count from.
  openingMinor: integer("opening_minor").notNull().default(0),
  openedOn: text("opened_on"),
  // Annual rate in basis points: 4.25% is 425. An integer, because money and rates
  // both lose to floating point.
  rateBp: integer("rate_bp"),
  // When a promotional rate lapses and the money should probably move.
  promoUntil: text("promo_until"),
  archivedAt: integer("archived_at"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
});

/**
 * What money is invested in: a brokerage portfolio, bonds.
 *
 * Purchase lots are deliberately absent. The question this answers is "what did it
 * grow by", and invested against value answers it. Lots earn their place when a
 * specific sale has to be taxed.
 */
export const holdings = sqliteTable("holdings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // "equity" or "bond".
  kind: text("kind").notNull(),
  // Sum of what was put in, moved by transfers rather than typed.
  investedMinor: integer("invested_minor").notNull().default(0),
  // What it is worth now. NULL until the first valuation: a holding bought today has
  // no price yet, and defaulting to zero would report it as a total loss.
  valueMinor: integer("value_minor"),
  valuedAt: text("valued_at"),
  rateBp: integer("rate_bp"),
  maturesOn: text("matures_on"),
  archivedAt: integer("archived_at"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
});

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
    // Units × 1 000 000. XTB reports four decimals (4.3823); three would round away a
    // digit the broker actually gave us, and floats are not allowed near money.
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
