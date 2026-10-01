import { describe, expect, test, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { app } from "../src/app";
import { createAccount, createHolding } from "../src/services/assets";
import { addTransactions } from "../src/services/transactions";

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

describe("asset history routes", () => {
  beforeEach(resetTestDb);

  test("GET /accounts/:id/history returns the movements", async () => {
    const pko = createAccount({
      name: "PKO",
      balanceMinor: 500000,
      openingMinor: 100000,
      openedOn: "2026-07-31",
    });
    addTransactions([
      { date: "2026-08-10", total: "4000.00", type: "transfer", toAccountId: pko.id },
    ]);

    const res = await api(`/api/accounts/${pko.id}/history`);
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.movements).toHaveLength(1);
    expect(body.movements[0].runningMinor).toBe(500000);
  });

  test("GET /holdings/:id/history carries lots and valuations", async () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });

    await send(`/api/holdings/${xtb.id}/lots`, "POST", {
      boughtOn: "2026-05-07",
      quantityMicro: 4382300,
      priceMinor: 15792,
      currency: "EUR",
      fxRate: 4248200,
      costMinor: 293998,
    });

    const res = await api(`/api/holdings/${xtb.id}/history`);
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.lots).toHaveLength(1);
    expect(body.lots[0].costMinor).toBe(293998);
  });

  test("a lot on a holding that does not exist is refused", async () => {
    const res = await send("/api/holdings/999/lots", "POST", {
      boughtOn: "2026-05-07",
      quantityMicro: 1000000,
      priceMinor: 10000,
      currency: "EUR",
      fxRate: 4000000,
      costMinor: 40000,
    });
    expect(res.status).toBe(404);
  });
});

describe("history of something that does not exist", () => {
  beforeEach(resetTestDb);

  test("an unknown account is 404, not an empty history", async () => {
    expect((await api("/api/accounts/999/history")).status).toBe(404);
  });

  test("an unknown holding is 404, not an empty history", async () => {
    expect((await api("/api/holdings/999/history")).status).toBe(404);
  });
});
