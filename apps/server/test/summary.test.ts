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
    {
      date,
      total,
      type: "income",
      merchant: "Salary",
      lineItems: [{ amount: total, category: "Income" }],
    },
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

  it("rejects a month number outside 01-12", () => {
    // Date.UTC rolls 13 over into January of the next year, so without an explicit
    // check the caller silently gets a different month's figures.
    seed();
    expect(() => getMonthSummary("2026-13")).toThrow(/month/i);
    expect(() => getMonthSummary("2026-00")).toThrow(/month/i);
  });

  it("rejects a malformed month string", () => {
    seed();
    expect(() => getMonthSummary("garbage")).toThrow(/month/i);
    expect(() => getMonthSummary("2026-8")).toThrow(/month/i);
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
