import { describe, expect, test, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { app } from "../src/app";

async function api(path: string, init?: RequestInit) {
  return app.handle(new Request(`http://localhost${path}`, init));
}

function send(path: string, method: string, body: unknown) {
  return api(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function json(res: Response) {
  return (await res.json()) as any;
}

describe("assets routes", () => {
  beforeEach(resetTestDb);

  test("GET /assets returns an empty shape before anything exists", async () => {
    const res = await api("/api/assets");
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.totalMinor).toBe(0);
    expect(body.accounts).toEqual([]);
  });

  test("POST /accounts creates one and GET /assets reflects it", async () => {
    const created = await send("/api/accounts", "POST", {
      name: "PKO",
      balanceMinor: 10712329,
      openingMinor: 0,
    });
    expect(created.status).toBe(200);

    const body = await json(await api("/api/assets"));
    expect(body.accountsTotalMinor).toBe(10712329);
  });

  test("PATCH /holdings/:id/value revalues", async () => {
    const created = await json(
      await send("/api/holdings", "POST", {
        name: "XTB",
        kind: "equity",
        investedMinor: 463000,
      }),
    );

    const res = await send(`/api/holdings/${created.id}/value`, "PATCH", {
      valueMinor: 590000,
      valuedAt: "2026-09-30",
    });
    expect(res.status).toBe(200);

    const body = await json(await api("/api/assets"));
    expect(body.holdings[0].growthMinor).toBe(127000);
  });

  test("a revaluation of an unknown holding is refused, not silently ignored", async () => {
    const res = await send("/api/holdings/999/value", "PATCH", {
      valueMinor: 1,
      valuedAt: "2026-09-30",
    });
    // 404, not 422: app.ts routes "not found" messages there, and the row really is gone.
    expect(res.status).toBe(404);
  });

  test("GET /assets carries the reconciliation gaps", async () => {
    await send("/api/accounts", "POST", {
      name: "PKO",
      balanceMinor: 600000,
      openingMinor: 100000,
      openedOn: "2026-07-31",
    });

    const body = await json(await api("/api/assets"));
    expect(body.reconciliation).toHaveLength(1);
    expect(body.reconciliation[0].differenceMinor).toBe(500000);
  });
});
