import { describe, expect, it, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { app } from "../src/app";
import { createCategory } from "../src/services/categories";
import { addTransactions } from "../src/services/transactions";

async function api(path: string) {
  return app.handle(new Request(`http://localhost${path}`));
}

beforeEach(() => {
  resetTestDb();
});

function seed() {
  const food = createCategory({ name: "Food" });
  createCategory({ name: "Groceries", parentId: food.id });
  createCategory({ name: "Income" });
}

describe("GET /api/categories", () => {
  it("returns the category tree", async () => {
    seed();
    const res = await api("/api/categories");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].children[0].name).toBe("Groceries");
  });
});

describe("GET /api/summary", () => {
  it("returns the month summary", async () => {
    seed();
    addTransactions([
      {
        date: "2026-08-05",
        total: "1000.00",
        type: "income",
        merchant: "Salary",
        lineItems: [{ amount: "1000.00", category: "Income" }],
      },
      {
        date: "2026-08-09",
        total: "250.00",
        merchant: "Shop",
        lineItems: [{ amount: "250.00", category: "Food/Groceries" }],
      },
    ]);

    const res = await api("/api/summary?month=2026-08");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.savingsRate).toBe(75);
    expect(body.spentMinor).toBe(25000);
  });

  it("rejects a malformed month", async () => {
    seed();
    const res = await api("/api/summary?month=nonsense");
    expect(res.status).toBe(422);
  });

  it("rejects a month number outside 01-12", async () => {
    seed();
    const res = await api("/api/summary?month=2026-13");
    expect(res.status).toBe(422);
  });
});

describe("GET /api/trend", () => {
  it("returns the requested span, oldest first", async () => {
    seed();
    const res = await api("/api/trend?month=2026-08&count=3");
    const body = await res.json();
    expect(body.map((p: { month: string }) => p.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });
});

describe("GET /api/breakdown", () => {
  it("returns category slices for the month", async () => {
    seed();
    addTransactions([
      {
        date: "2026-08-09",
        total: "250.00",
        merchant: "Shop",
        lineItems: [{ amount: "250.00", category: "Food/Groceries" }],
      },
    ]);

    const res = await api("/api/breakdown?month=2026-08");
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("Food");
    expect(body[0].share).toBe(100);
  });
});

describe("GET /api/transactions", () => {
  it("returns rows with their lines and a total", async () => {
    seed();
    addTransactions([
      {
        date: "2026-08-09",
        total: "250.00",
        merchant: "Shop",
        lineItems: [{ amount: "250.00", category: "Food/Groceries" }],
      },
    ]);

    const res = await api("/api/transactions?month=2026-08");
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.rows[0].lines[0].categoryPath).toBe("Food/Groceries");
  });
});

describe("GET /api/merchants", () => {
  it("returns known merchants", async () => {
    seed();
    addTransactions([
      {
        date: "2026-08-09",
        total: "250.00",
        merchant: "Biedronka",
        lineItems: [{ amount: "250.00", category: "Food/Groceries" }],
      },
    ]);

    const res = await api("/api/merchants");
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].nameNorm).toBe("biedronka");
  });
});
