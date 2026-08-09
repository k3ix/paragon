import { describe, expect, it, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { app } from "../src/app";
import { createCategory } from "../src/services/categories";
import { addTransactions } from "../src/services/transactions";
import { listTransactions } from "../src/services/queries";

async function api(path: string, init?: RequestInit) {
  return app.handle(new Request(`http://localhost${path}`, init));
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

beforeEach(() => {
  resetTestDb();
});

function seed() {
  const food = createCategory({ name: "Food" });
  createCategory({ name: "Groceries", parentId: food.id });
  const home = createCategory({ name: "Home" });
  createCategory({ name: "Cleaning", parentId: home.id });
}

function one() {
  seed();
  addTransactions([
    {
      date: "2026-08-09",
      total: "100.00",
      merchant: "Shop",
      lineItems: [{ amount: "100.00", category: "Food/Groceries" }],
    },
  ]);
  return listTransactions({}).rows[0]!;
}

describe("PATCH /api/transactions/:id", () => {
  it("updates the note", async () => {
    const tx = one();
    const res = await api(`/api/transactions/${tx.id}`, json("PATCH", { note: "checked" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.note).toBe("checked");
  });

  it("replaces the line items", async () => {
    const tx = one();
    const res = await api(
      `/api/transactions/${tx.id}`,
      json("PATCH", {
        lineItems: [
          { amount: "70.00", category: "Food/Groceries" },
          { amount: "30.00", category: "Home/Cleaning" },
        ],
      }),
    );

    const body = await res.json();
    expect(body.lines).toHaveLength(2);
  });

  it("returns 422 when the lines do not sum to the total", async () => {
    const tx = one();
    const res = await api(
      `/api/transactions/${tx.id}`,
      json("PATCH", { lineItems: [{ amount: "60.00", category: "Food/Groceries" }] }),
    );
    expect(res.status).toBe(422);
  });

  it("returns 404 for an unknown id", async () => {
    seed();
    const res = await api("/api/transactions/9999", json("PATCH", { note: "x" }));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/transactions/:id", () => {
  it("deletes the transaction", async () => {
    const tx = one();
    const res = await api(`/api/transactions/${tx.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(listTransactions({}).rows).toHaveLength(0);
  });

  it("returns 404 for an unknown id", async () => {
    seed();
    const res = await api("/api/transactions/9999", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("category routes", () => {
  it("creates a category", async () => {
    seed();
    const res = await api("/api/categories", json("POST", { name: "Transport" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.name).toBe("Transport");
  });

  it("renames a category", async () => {
    seed();
    const created = await (await api("/api/categories", json("POST", { name: "Temp" }))).json();
    const res = await api(`/api/categories/${created.id}`, json("PATCH", { name: "Renamed" }));

    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe("Renamed");
  });

  it("returns 422 for a move that would create a cycle", async () => {
    seed();
    const parent = await (await api("/api/categories", json("POST", { name: "Parent" }))).json();
    const child = await (
      await api("/api/categories", json("POST", { name: "Child", parentId: parent.id }))
    ).json();

    const res = await api(`/api/categories/${parent.id}`, json("PATCH", { parentId: child.id }));
    expect(res.status).toBe(422);
  });

  it("archives a category", async () => {
    seed();
    const created = await (await api("/api/categories", json("POST", { name: "Gone" }))).json();
    const res = await api(`/api/categories/${created.id}`, { method: "DELETE" });

    expect(res.status).toBe(200);

    const tree = await (await api("/api/categories")).json();
    expect(tree.map((c: { name: string }) => c.name)).not.toContain("Gone");
  });
});

describe("POST /api/reassign", () => {
  it("moves lines and reports the count", async () => {
    seed();
    addTransactions([
      {
        date: "2026-08-09",
        total: "100.00",
        merchant: "Leroy Merlin",
        lineItems: [{ amount: "100.00", category: "Home/Cleaning" }],
      },
    ]);

    const res = await api(
      "/api/reassign",
      json("POST", { fromCategory: "Home/Cleaning", toCategory: "Food/Groceries" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.moved).toBe(1);
  });

  it("previews without changing anything", async () => {
    seed();
    addTransactions([
      {
        date: "2026-08-09",
        total: "100.00",
        merchant: "Shop",
        lineItems: [{ amount: "100.00", category: "Home/Cleaning" }],
      },
    ]);

    const res = await api(
      "/api/reassign",
      json("POST", {
        fromCategory: "Home/Cleaning",
        toCategory: "Food/Groceries",
        preview: true,
      }),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).count).toBe(1);

    // Still where it was.
    const after = await (await api("/api/breakdown?month=2026-08")).json();
    expect(after[0].name).toBe("Home");
  });

  it("returns 422 for an empty filter", async () => {
    seed();
    const res = await api("/api/reassign", json("POST", { toCategory: "Food/Groceries" }));
    expect(res.status).toBe(422);
  });

  it("returns 422 for an unknown destination", async () => {
    seed();
    const res = await api(
      "/api/reassign",
      json("POST", { fromCategory: "Home/Cleaning", toCategory: "Nope/Missing" }),
    );
    expect(res.status).toBe(422);
  });
});
