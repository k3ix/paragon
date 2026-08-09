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
