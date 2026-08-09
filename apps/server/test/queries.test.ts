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
      {
        date: "2026-08-01",
        total: "10.00",
        merchant: "A",
        lineItems: [{ amount: "10.00", category: "Food/Groceries" }],
      },
      {
        date: "2026-08-09",
        total: "20.00",
        merchant: "B",
        lineItems: [{ amount: "20.00", category: "Food/Groceries" }],
      },
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
      {
        date: "2026-07-31",
        total: "10.00",
        merchant: "July",
        lineItems: [{ amount: "10.00", category: "Food/Groceries" }],
      },
      {
        date: "2026-08-01",
        total: "20.00",
        merchant: "August",
        lineItems: [{ amount: "20.00", category: "Food/Groceries" }],
      },
    ]);

    const { rows, total } = listTransactions({ month: "2026-08" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.merchantRaw).toBe("August");
    expect(total).toBe(1);
  });

  it("filters by type", () => {
    seed();
    addTransactions([
      {
        date: "2026-08-01",
        total: "10.00",
        merchant: "Shop",
        lineItems: [{ amount: "10.00", category: "Food/Groceries" }],
      },
      {
        date: "2026-08-05",
        total: "1000.00",
        type: "income",
        merchant: "Salary",
        lineItems: [{ amount: "1000.00", category: "Income" }],
      },
    ]);

    const { rows } = listTransactions({ type: "income" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.merchantRaw).toBe("Salary");
  });

  it("paginates and reports the unpaginated total", () => {
    seed();
    addTransactions([
      {
        date: "2026-08-01",
        total: "10.00",
        merchant: "A",
        lineItems: [{ amount: "10.00", category: "Food/Groceries" }],
      },
      {
        date: "2026-08-02",
        total: "20.00",
        merchant: "B",
        lineItems: [{ amount: "20.00", category: "Food/Groceries" }],
      },
      {
        date: "2026-08-03",
        total: "30.00",
        merchant: "C",
        lineItems: [{ amount: "30.00", category: "Food/Groceries" }],
      },
    ]);

    const { rows, total } = listTransactions({ limit: 2 });
    expect(rows).toHaveLength(2);
    expect(total).toBe(3);

    const second = listTransactions({ limit: 2, offset: 2 });
    expect(second.rows).toHaveLength(1);
  });

  it("rejects an invalid month rather than returning another month's rows", () => {
    seed();
    expect(() => listTransactions({ month: "2026-13" })).toThrow(/month/i);
  });
});
