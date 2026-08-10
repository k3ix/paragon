import { describe, expect, it, beforeEach } from "bun:test";
import { resetTestDb, db, schema } from "./helpers/db";
import { addTransactions } from "../src/services/transactions";
import { createCategory, findCategoryByPath } from "../src/services/categories";
import { listTransactions } from "../src/services/queries";

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
  it("creates a transaction with a single explicit line", () => {
    seedCategories();
    const [result] = addTransactions([
      {
        date: "2026-08-09",
        total: "23.50",
        merchant: "Żabka",
        lineItems: [{ amount: "23.50", category: "Food/Groceries" }],
      },
    ]);

    expect(result!.status).toBe("created");
    const lines = db.select().from(schema.lineItems).all();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.amountMinor).toBe(2350);
  });

  it("creates one uncategorized line covering the total when none are given", () => {
    // "No receipt means one line for the full amount" — the spec's invariant. A push
    // notification gives an amount and a merchant but no breakdown, so the line is
    // written without a category and gets classified later.
    seedCategories();
    const [result] = addTransactions([
      { date: "2026-08-09", total: "23.50", merchant: "Żabka" },
    ]);

    expect(result!.status).toBe("created");
    const lines = db.select().from(schema.lineItems).all();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.amountMinor).toBe(2350);
    expect(lines[0]!.categoryId).toBeNull();
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
        {
          date: "2026-08-09",
          total: "100.00",
          merchant: "Test",
          lineItems: [{ amount: "50.00", category: "Food/Groceries" }],
        },
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
      {
        date: "2026-08-09",
        total: "23.50",
        merchant: "Żabka",
        lineItems: [{ amount: "23.50", category: "Food/Groceries" }],
      },
    ]);
    const [second] = addTransactions([
      {
        date: "2026-08-09",
        total: "23.50",
        merchant: "ZABKA",
        lineItems: [{ amount: "23.50", category: "Food/Groceries" }],
      },
    ]);

    expect(second!.status).toBe("already_exists");
  });

  it("does not deduplicate two genuinely different amounts on one day", () => {
    seedCategories();
    addTransactions([
      {
        date: "2026-08-09",
        total: "23.50",
        merchant: "Żabka",
        lineItems: [{ amount: "23.50", category: "Food/Groceries" }],
      },
    ]);
    const [second] = addTransactions([
      {
        date: "2026-08-09",
        total: "17.90",
        merchant: "Żabka",
        lineItems: [{ amount: "17.90", category: "Food/Groceries" }],
      },
    ]);

    expect(second!.status).toBe("created");
    expect(db.select().from(schema.transactions).all()).toHaveLength(2);
  });

  it("creates a merchant row and counts sightings", () => {
    seedCategories();
    addTransactions([
      {
        date: "2026-08-09",
        total: "23.50",
        merchant: "Żabka",
        lineItems: [{ amount: "23.50", category: "Food/Groceries" }],
      },
    ]);
    addTransactions([
      {
        date: "2026-08-10",
        total: "17.90",
        merchant: "Żabka",
        lineItems: [{ amount: "17.90", category: "Food/Groceries" }],
      },
    ]);

    const merchants = db.select().from(schema.merchants).all();
    expect(merchants).toHaveLength(1);
    expect(merchants[0]!.nameNorm).toBe("zabka");
    expect(merchants[0]!.seenCount).toBe(2);
  });

  it("keeps the raw merchant string alongside the normalized one", () => {
    seedCategories();
    addTransactions([
      {
        date: "2026-08-09",
        total: "23.50",
        merchant: "ZABKA NANO Z1234",
        lineItems: [{ amount: "23.50", category: "Food/Groceries" }],
      },
    ]);

    const tx = db.select().from(schema.transactions).all()[0]!;
    expect(tx.merchantRaw).toBe("ZABKA NANO Z1234");
  });

  it("stores the date as a Unix timestamp", () => {
    seedCategories();
    addTransactions([
      {
        date: "2026-08-09",
        total: "23.50",
        merchant: "Żabka",
        lineItems: [{ amount: "23.50", category: "Food/Groceries" }],
      },
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
      {
        date: "2026-08-09",
        total: "23.50",
        merchant: "Żabka",
        lineItems: [{ amount: "23.50", category: "Food/Groceries" }],
      },
      {
        date: "2026-08-08",
        total: "310.00",
        merchant: "Orlen",
        lineItems: [{ amount: "310.00", category: "Food/Groceries" }],
      },
    ]);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "created")).toBe(true);
    expect(db.select().from(schema.transactions).all()).toHaveLength(2);
  });

  it("rejects an unknown category path", () => {
    seedCategories();
    expect(() =>
      addTransactions([
        {
          date: "2026-08-09",
          total: "23.50",
          merchant: "Żabka",
          lineItems: [{ amount: "23.50", category: "Nonexistent/Path" }],
        },
      ]),
    ).toThrow(/category/i);
  });

  it("defaults the type to expense", () => {
    seedCategories();
    addTransactions([
      {
        date: "2026-08-09",
        total: "23.50",
        merchant: "Żabka",
        lineItems: [{ amount: "23.50", category: "Food/Groceries" }],
      },
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
});

describe("line item names", () => {
  it("keeps what was bought alongside its category", () => {
    createCategory({ name: "Одежда" });
    createCategory({ name: "Питомцы" });

    const [result] = addTransactions([
      {
        date: "2026-08-10",
        total: "20.00",
        merchant: "Temu",
        lineItems: [
          { amount: "13.00", category: "Одежда", name: "Балетки белые" },
          { amount: "7.00", category: "Питомцы", name: "Игрушка для кота" },
        ],
      },
    ]);

    const row = listTransactions({ month: "2026-08" }).rows.find((r) => r.id === result!.id)!;

    expect(row.lines.map((l) => l.name)).toEqual(["Балетки белые", "Игрушка для кота"]);
  });

  it("leaves the name empty when none was given", () => {
    createCategory({ name: "Еда" });

    const [result] = addTransactions([
      {
        date: "2026-08-10",
        total: "10.00",
        merchant: "Żabka",
        lineItems: [{ amount: "10.00", category: "Еда" }],
      },
    ]);

    const row = listTransactions({ month: "2026-08" }).rows.find((r) => r.id === result!.id)!;

    expect(row.lines[0]!.name).toBeNull();
  });
});
