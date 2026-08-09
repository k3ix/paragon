import { describe, expect, it, beforeEach } from "bun:test";
import { resetTestDb, db, schema } from "./helpers/db";
import { createCategory } from "../src/services/categories";
import {
  addTransactions,
  updateTransaction,
  deleteTransaction,
} from "../src/services/transactions";
import { listTransactions } from "../src/services/queries";

beforeEach(() => {
  resetTestDb();
});

function seed() {
  const food = createCategory({ name: "Food" });
  createCategory({ name: "Groceries", parentId: food.id });
  const home = createCategory({ name: "Home" });
  createCategory({ name: "Cleaning", parentId: home.id });
}

function one(merchant = "Shop", total = "100.00", category = "Food/Groceries") {
  seed();
  addTransactions([
    { date: "2026-08-09", total, merchant, lineItems: [{ amount: total, category }] },
  ]);
  return listTransactions({}).rows[0]!;
}

describe("updateTransaction", () => {
  it("changes the note", () => {
    const tx = one();
    const updated = updateTransaction(tx.id, { note: "reimbursed" });
    expect(updated.note).toBe("reimbursed");
  });

  it("changes the merchant and keeps the raw spelling", () => {
    const tx = one();
    const updated = updateTransaction(tx.id, { merchant: "Biedronka" });
    expect(updated.merchantRaw).toBe("Biedronka");
  });

  it("changes the date", () => {
    const tx = one();
    const updated = updateTransaction(tx.id, { date: "2026-08-15" });
    expect(updated.occurredOn).toBe(Math.floor(Date.UTC(2026, 7, 15) / 1000));
  });

  it("rewrites the single line when the total changes", () => {
    const tx = one("Shop", "100.00");
    const updated = updateTransaction(tx.id, { total: "120.00" });
    expect(updated.totalMinor).toBe(12000);
    expect(updated.lines).toHaveLength(1);
    expect(updated.lines[0]!.amountMinor).toBe(12000);
  });

  it("refuses to change the total alone when several lines exist", () => {
    seed();
    addTransactions([
      {
        date: "2026-08-09",
        total: "100.00",
        merchant: "Split",
        lineItems: [
          { amount: "60.00", category: "Food/Groceries" },
          { amount: "40.00", category: "Home/Cleaning" },
        ],
      },
    ]);
    const tx = listTransactions({}).rows[0]!;

    expect(() => updateTransaction(tx.id, { total: "120.00" })).toThrow(/line items/i);
  });

  it("replaces the lines when they are supplied", () => {
    const tx = one("Shop", "100.00");
    const updated = updateTransaction(tx.id, {
      total: "100.00",
      lineItems: [
        { amount: "70.00", category: "Food/Groceries" },
        { amount: "30.00", category: "Home/Cleaning" },
      ],
    });

    expect(updated.lines).toHaveLength(2);
    expect(updated.lines.map((l) => l.amountMinor).sort((a, b) => a - b)).toEqual([3000, 7000]);
  });

  it("rejects lines that do not sum to the total", () => {
    const tx = one("Shop", "100.00");
    expect(() =>
      updateTransaction(tx.id, {
        lineItems: [{ amount: "60.00", category: "Food/Groceries" }],
      }),
    ).toThrow(/does not match/i);
  });

  it("leaves the row untouched when the edit is rejected", () => {
    const tx = one("Shop", "100.00");
    try {
      updateTransaction(tx.id, { lineItems: [{ amount: "60.00", category: "Food/Groceries" }] });
    } catch {
      // expected
    }

    const after = listTransactions({}).rows[0]!;
    expect(after.totalMinor).toBe(10000);
    expect(after.lines).toHaveLength(1);
    expect(after.lines[0]!.amountMinor).toBe(10000);
  });

  it("rejects an unknown category path", () => {
    const tx = one();
    expect(() =>
      updateTransaction(tx.id, {
        lineItems: [{ amount: "100.00", category: "Nope/Missing" }],
      }),
    ).toThrow(/category/i);
  });

  it("recomputes the dedup hash when the amount changes", () => {
    const tx = one("Shop", "100.00");
    const before = db
      .select()
      .from(schema.transactions)
      .all()
      .find((t) => t.id === tx.id)!.dedupHash;

    updateTransaction(tx.id, { total: "120.00" });

    const after = db
      .select()
      .from(schema.transactions)
      .all()
      .find((t) => t.id === tx.id)!.dedupHash;
    expect(after).not.toBe(before);
  });

  it("refuses an edit that would duplicate another transaction", () => {
    seed();
    addTransactions([
      {
        date: "2026-08-09",
        total: "50.00",
        merchant: "Żabka",
        lineItems: [{ amount: "50.00", category: "Food/Groceries" }],
      },
      {
        date: "2026-08-09",
        total: "70.00",
        merchant: "Żabka",
        lineItems: [{ amount: "70.00", category: "Food/Groceries" }],
      },
    ]);
    const rows = listTransactions({}).rows;
    const target = rows.find((r) => r.totalMinor === 7000)!;

    // Making the second one identical to the first would collide on dedup_hash.
    expect(() => updateTransaction(target.id, { total: "50.00" })).toThrow(/already exists/i);
  });

  it("rejects an unknown transaction id", () => {
    seed();
    expect(() => updateTransaction(9999, { note: "x" })).toThrow(/not found/i);
  });
});

describe("deleteTransaction", () => {
  it("removes the transaction", () => {
    const tx = one();
    deleteTransaction(tx.id);
    expect(listTransactions({}).rows).toHaveLength(0);
  });

  it("removes its line items too", () => {
    const tx = one();
    deleteTransaction(tx.id);
    expect(db.select().from(schema.lineItems).all()).toHaveLength(0);
  });

  it("rejects an unknown id", () => {
    seed();
    expect(() => deleteTransaction(9999)).toThrow(/not found/i);
  });
});
