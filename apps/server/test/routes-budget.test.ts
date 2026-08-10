import { describe, expect, it, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { app } from "../src/app";

async function api(path: string, init?: RequestInit) {
  return app.handle(new Request(`http://localhost${path}`, init));
}

function json(path: string, method: string, body: unknown) {
  return api(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetTestDb();
});

describe("GET /api/budget", () => {
  it("answers for a month", async () => {
    const res = await api("/api/budget?month=2026-08");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.month).toBe("2026-08");
    expect(body.setAsideMinor).toBeNull();
    expect(body.reason).toBe("no-base-income");
  });

  it("refuses an impossible month", async () => {
    expect((await api("/api/budget?month=2026-13")).status).toBe(422);
  });

  it("refuses a malformed month", async () => {
    expect((await api("/api/budget?month=august")).status).toBe(422);
  });
});

describe("GET /api/pace", () => {
  it("answers for a month", async () => {
    const res = await api("/api/pace?month=2026-08");
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty("daysRemaining");
  });
});

describe("GET /api/tree", () => {
  it("returns an array", async () => {
    const res = await api("/api/tree?month=2026-08");
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });
});

describe("/api/commitments", () => {
  it("creates, lists, patches and ends a commitment", async () => {
    const created = await json("/api/commitments", "POST", {
      kind: "expense",
      name: "Аренда",
      amountMinor: 400000,
      activeFrom: "2026-08",
    });
    expect(created.status).toBe(200);
    const commitment = await created.json();
    expect(commitment.amountMinor).toBe(400000);

    const listed = await api("/api/commitments");
    expect(await listed.json()).toHaveLength(1);

    const patched = await json(`/api/commitments/${commitment.id}`, "PATCH", {
      amountMinor: 450000,
    });
    expect((await patched.json()).amountMinor).toBe(450000);

    const ended = await api(`/api/commitments/${commitment.id}?month=2026-09`, {
      method: "DELETE",
    });
    expect((await ended.json()).activeTo).toBe("2026-09");
  });

  it("refuses a zero amount", async () => {
    const res = await json("/api/commitments", "POST", {
      kind: "expense",
      name: "Аренда",
      amountMinor: 0,
      activeFrom: "2026-08",
    });
    expect(res.status).toBe(422);
  });

  it("refuses a range that ends before it starts", async () => {
    const res = await json("/api/commitments", "POST", {
      kind: "expense",
      name: "Аренда",
      amountMinor: 400000,
      activeFrom: "2026-08",
      activeTo: "2026-07",
    });
    expect(res.status).toBe(422);
  });

  it("reports a missing commitment as not found", async () => {
    const res = await json("/api/commitments/9999", "PATCH", { amountMinor: 100 });
    expect(res.status).toBe(404);
  });

  it("feeds the budget once a salary and history exist", async () => {
    await json("/api/commitments", "POST", {
      kind: "income",
      name: "Зарплата",
      amountMinor: 2800000,
      activeFrom: "2026-01",
    });

    const body = await (await api("/api/budget?month=2026-08")).json();
    expect(body.baseIncomeMinor).toBe(2800000);
    // Still no spending history, so the figure waits rather than guessing.
    expect(body.reason).toBe("not-enough-history");
  });
});
