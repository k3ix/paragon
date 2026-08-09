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
