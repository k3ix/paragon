import { describe, expect, it, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { getMerchant, listMerchants, setMerchantCategory } from "../src/services/merchants";
import { createCategory } from "../src/services/categories";
import { addTransactions } from "../src/services/transactions";

beforeEach(() => {
  resetTestDb();
});

function seedCategories() {
  const food = createCategory({ name: "Food" });
  createCategory({ name: "Groceries", parentId: food.id });
  const home = createCategory({ name: "Home" });
  createCategory({ name: "Cleaning", parentId: home.id });
}

function record(merchant: string, date: string, total: string, category?: string) {
  addTransactions([
    {
      date,
      total,
      merchant,
      lineItems: category ? [{ amount: total, category }] : undefined,
    },
  ]);
}

describe("getMerchant", () => {
  it("returns null for an unknown merchant", () => {
    seedCategories();
    expect(getMerchant("Nonexistent")).toBeNull();
  });

  it("returns the remembered category as a path", () => {
    seedCategories();
    record("Żabka", "2026-08-09", "23.50", "Food/Groceries");

    const memory = getMerchant("Żabka");
    expect(memory?.categoryPath).toBe("Food/Groceries");
  });

  it("matches the bank spelling of the same shop", () => {
    seedCategories();
    record("Żabka", "2026-08-09", "23.50", "Food/Groceries");

    // The statement writes it without diacritics and in capitals.
    expect(getMerchant("ZABKA")?.categoryPath).toBe("Food/Groceries");
  });

  it("reports how many times the merchant was seen", () => {
    seedCategories();
    record("Żabka", "2026-08-09", "23.50", "Food/Groceries");
    record("Żabka", "2026-08-10", "17.90", "Food/Groceries");

    expect(getMerchant("Żabka")?.seenCount).toBe(2);
  });

  it("reports the average transaction total in minor units", () => {
    seedCategories();
    record("Żabka", "2026-08-09", "20.00", "Food/Groceries");
    record("Żabka", "2026-08-10", "10.00", "Food/Groceries");

    expect(getMerchant("Żabka")?.averageMinor).toBe(1500);
  });

  it("reports a null category when nothing was ever learned", () => {
    seedCategories();
    record("Żabka", "2026-08-09", "23.50");

    const memory = getMerchant("Żabka");
    expect(memory).not.toBeNull();
    expect(memory?.categoryPath).toBeNull();
  });

  it("builds a deep path for a nested category", () => {
    const home = createCategory({ name: "Home" });
    const household = createCategory({ name: "Household", parentId: home.id });
    createCategory({ name: "Cleaning", parentId: household.id });
    record("Rossmann", "2026-08-09", "31.00", "Home/Household/Cleaning");

    expect(getMerchant("Rossmann")?.categoryPath).toBe("Home/Household/Cleaning");
  });
});

describe("listMerchants", () => {
  it("returns an empty array when there are none", () => {
    expect(listMerchants()).toEqual([]);
  });

  it("orders by sighting count, most frequent first", () => {
    seedCategories();
    record("Orlen", "2026-08-01", "310.00", "Food/Groceries");
    record("Żabka", "2026-08-09", "23.50", "Food/Groceries");
    record("Żabka", "2026-08-10", "17.90", "Food/Groceries");

    const list = listMerchants();
    expect(list.map((m) => m.nameNorm)).toEqual(["zabka", "orlen"]);
  });
});

describe("setMerchantCategory", () => {
  it("overrides a learned default", () => {
    seedCategories();
    record("Rossmann", "2026-08-09", "31.00", "Food/Groceries");

    const updated = setMerchantCategory("Rossmann", "Home/Cleaning");
    expect(updated.categoryPath).toBe("Home/Cleaning");
    expect(getMerchant("Rossmann")?.categoryPath).toBe("Home/Cleaning");
  });

  it("creates the memory for a merchant with no transactions yet", () => {
    seedCategories();
    const created = setMerchantCategory("Lidl", "Food/Groceries");

    expect(created.nameNorm).toBe("lidl");
    expect(created.categoryPath).toBe("Food/Groceries");
    expect(created.seenCount).toBe(0);
  });

  it("rejects an unknown category path", () => {
    seedCategories();
    expect(() => setMerchantCategory("Lidl", "Nonexistent/Path")).toThrow(/category/i);
  });

  it("does not change past transactions", () => {
    seedCategories();
    record("Rossmann", "2026-08-09", "31.00", "Food/Groceries");
    setMerchantCategory("Rossmann", "Home/Cleaning");

    // Only the default for next time moves; history is phase 5's job.
    const memory = getMerchant("Rossmann");
    expect(memory?.categoryPath).toBe("Home/Cleaning");
    expect(memory?.seenCount).toBe(1);
  });
});
