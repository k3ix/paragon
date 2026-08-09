import { describe, expect, it, beforeEach } from "bun:test";
import { resetTestDb, db, schema } from "./helpers/db";
import { createCategory, findCategoryByPath } from "../src/services/categories";
import { addTransactions } from "../src/services/transactions";
import { previewReassign, reassignLineItems } from "../src/services/reassign";
import { getCategoryBreakdown } from "../src/services/summary";

beforeEach(() => {
  resetTestDb();
});

function seed() {
  const home = createCategory({ name: "Home" });
  createCategory({ name: "Household", parentId: home.id });
  createCategory({ name: "Repairs", parentId: home.id });
  const food = createCategory({ name: "Food" });
  createCategory({ name: "Groceries", parentId: food.id });
  createCategory({ name: "Renovation" });
}

function expense(date: string, total: string, category: string, merchant: string) {
  addTransactions([{ date, total, merchant, lineItems: [{ amount: total, category }] }]);
}

describe("previewReassign", () => {
  it("counts the lines a filter would move", () => {
    seed();
    expense("2026-08-01", "100.00", "Home/Household", "Leroy Merlin");
    expense("2026-08-02", "200.00", "Home/Household", "Castorama");
    expense("2026-08-03", "300.00", "Food/Groceries", "Biedronka");

    const preview = previewReassign({ fromCategory: "Home/Household" });
    expect(preview.count).toBe(2);
    expect(preview.totalMinor).toBe(30000);
  });

  it("names the merchants involved so the user can recognise them", () => {
    seed();
    expense("2026-08-01", "100.00", "Home/Household", "Leroy Merlin");
    expense("2026-08-02", "200.00", "Home/Household", "Castorama");

    const preview = previewReassign({ fromCategory: "Home/Household" });
    expect(preview.sampleMerchants.sort()).toEqual(["castorama", "leroy merlin"]);
  });

  it("returns zero for a filter that matches nothing", () => {
    seed();
    expect(previewReassign({ merchant: "Nonexistent" }).count).toBe(0);
  });
});

describe("reassignLineItems", () => {
  it("moves lines from one category to another", () => {
    seed();
    expense("2026-08-01", "100.00", "Home/Household", "Leroy Merlin");

    const result = reassignLineItems({ fromCategory: "Home/Household" }, "Home/Repairs");

    expect(result.moved).toBe(1);
    expect(result.toCategory).toBe("Home/Repairs");

    const repairs = findCategoryByPath("Home/Repairs")!;
    const lines = db.select().from(schema.lineItems).all();
    expect(lines[0]!.categoryId).toBe(repairs);
  });

  it("includes the whole subtree of the source category", () => {
    seed();
    // Filed on the parent and on a child; both must move.
    expense("2026-08-01", "100.00", "Home", "Rent");
    expense("2026-08-02", "200.00", "Home/Household", "Leroy Merlin");
    expense("2026-08-03", "300.00", "Home/Repairs", "Castorama");

    const result = reassignLineItems({ fromCategory: "Home" }, "Renovation");
    expect(result.moved).toBe(3);
  });

  it("moves every line of a merchant regardless of month", () => {
    seed();
    expense("2026-06-01", "100.00", "Home/Household", "Rossmann");
    expense("2026-07-01", "200.00", "Home/Household", "Rossmann");
    expense("2026-08-01", "300.00", "Food/Groceries", "Rossmann");

    const result = reassignLineItems({ merchant: "Rossmann" }, "Home/Repairs");
    expect(result.moved).toBe(3);
  });

  it("matches a merchant through its normalized name", () => {
    seed();
    expense("2026-08-01", "100.00", "Food/Groceries", "Żabka");

    // The caller types the bank's spelling; it must still match.
    const result = reassignLineItems({ merchant: "ZABKA" }, "Home/Household");
    expect(result.moved).toBe(1);
  });

  it("restricts to a month when asked", () => {
    seed();
    expense("2026-07-01", "100.00", "Home/Household", "Leroy Merlin");
    expense("2026-08-01", "200.00", "Home/Household", "Leroy Merlin");

    const result = reassignLineItems(
      { fromCategory: "Home/Household", month: "2026-08" },
      "Home/Repairs",
    );
    expect(result.moved).toBe(1);
  });

  it("combines filters as an intersection", () => {
    seed();
    expense("2026-08-01", "100.00", "Home/Household", "Leroy Merlin");
    expense("2026-08-02", "200.00", "Home/Household", "Castorama");

    const result = reassignLineItems(
      { fromCategory: "Home/Household", merchant: "Leroy Merlin" },
      "Home/Repairs",
    );
    expect(result.moved).toBe(1);
  });

  it("moves specific transactions by id", () => {
    seed();
    expense("2026-08-01", "100.00", "Home/Household", "A");
    expense("2026-08-02", "200.00", "Home/Household", "B");

    const ids = db
      .select()
      .from(schema.transactions)
      .all()
      .map((t) => t.id);

    const result = reassignLineItems({ transactionIds: [ids[0]!] }, "Home/Repairs");
    expect(result.moved).toBe(1);
  });

  it("moves only uncategorized lines when asked", () => {
    seed();
    addTransactions([{ date: "2026-08-01", total: "50.00", merchant: "Unknown" }]);
    expense("2026-08-02", "100.00", "Food/Groceries", "Biedronka");

    const result = reassignLineItems({ uncategorizedOnly: true }, "Home/Household");
    expect(result.moved).toBe(1);
  });

  it("never changes an amount", () => {
    seed();
    expense("2026-08-01", "184.20", "Home/Household", "Biedronka");

    reassignLineItems({ fromCategory: "Home/Household" }, "Home/Repairs");

    const line = db.select().from(schema.lineItems).all()[0]!;
    const tx = db.select().from(schema.transactions).all()[0]!;
    expect(line.amountMinor).toBe(18420);
    expect(tx.totalMinor).toBe(18420);
  });

  it("keeps the line-sum invariant intact on a split receipt", () => {
    seed();
    addTransactions([
      {
        date: "2026-08-01",
        total: "300.00",
        merchant: "Biedronka",
        lineItems: [
          { amount: "100.00", category: "Food/Groceries" },
          { amount: "200.00", category: "Home/Household" },
        ],
      },
    ]);

    reassignLineItems({ fromCategory: "Home/Household" }, "Home/Repairs");

    const tx = db.select().from(schema.transactions).all()[0]!;
    const lines = db.select().from(schema.lineItems).all();
    expect(lines.reduce((sum, l) => sum + l.amountMinor, 0)).toBe(tx.totalMinor);
  });

  it("recalculates past statistics", () => {
    seed();
    expense("2026-08-01", "100.00", "Home/Household", "Leroy Merlin");
    expense("2026-08-02", "300.00", "Food/Groceries", "Biedronka");

    const before = getCategoryBreakdown("2026-08");
    expect(before.find((s) => s.name === "Home")!.totalMinor).toBe(10000);

    // This is the feature: history follows the taxonomy.
    reassignLineItems({ fromCategory: "Home/Household" }, "Renovation");

    const after = getCategoryBreakdown("2026-08");
    expect(after.find((s) => s.name === "Home")).toBeUndefined();
    expect(after.find((s) => s.name === "Renovation")!.totalMinor).toBe(10000);
  });

  it("rejects an empty filter", () => {
    seed();
    expense("2026-08-01", "100.00", "Food/Groceries", "Biedronka");

    // Moving everything is never what anyone means, and there is no undo.
    expect(() => reassignLineItems({}, "Home/Repairs")).toThrow(/filter/i);
  });

  it("rejects an unknown destination category", () => {
    seed();
    expense("2026-08-01", "100.00", "Home/Household", "Leroy Merlin");
    expect(() => reassignLineItems({ fromCategory: "Home/Household" }, "Nope/Missing")).toThrow(
      /category/i,
    );
  });

  it("rejects an unknown source category", () => {
    seed();
    expect(() => reassignLineItems({ fromCategory: "Nope/Missing" }, "Home/Repairs")).toThrow(
      /category/i,
    );
  });

  it("reports zero when the filter matches nothing", () => {
    seed();
    expense("2026-08-01", "100.00", "Food/Groceries", "Biedronka");

    const result = reassignLineItems({ merchant: "Nonexistent" }, "Home/Repairs");
    expect(result.moved).toBe(0);
  });

  it("supports merging: move A into B, then archive A", () => {
    seed();
    expense("2026-08-01", "100.00", "Home/Household", "A");
    expense("2026-08-02", "200.00", "Home/Repairs", "B");

    // Merge Household into Repairs — the spec's stated way to merge categories.
    const result = reassignLineItems({ fromCategory: "Home/Household" }, "Home/Repairs");
    expect(result.moved).toBe(1);

    const repairs = findCategoryByPath("Home/Repairs")!;
    const lines = db.select().from(schema.lineItems).all();
    expect(lines.every((l) => l.categoryId === repairs)).toBe(true);
  });
});
