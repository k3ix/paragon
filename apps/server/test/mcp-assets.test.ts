import { describe, expect, test, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { createAccount, createHolding, revalueHolding } from "../src/services/assets";
import { handler as listAssets } from "../src/mcp/tools/list-assets";
import { handler as recordAsset } from "../src/mcp/tools/record-asset";

describe("list_assets", () => {
  beforeEach(resetTestDb);

  test("says so plainly when nothing is recorded", async () => {
    const result = await listAssets();
    expect(result.content[0]?.text).toContain("No accounts or holdings recorded yet");
  });

  test("renders accounts and holdings with the total", async () => {
    createAccount({ name: "PKO", balanceMinor: 10712329, openingMinor: 0, rateBp: 425 });
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 463000 });
    revalueHolding(xtb.id, 590000, "2026-09-30");

    const text = (await listAssets()).content[0]?.text ?? "";
    expect(text).toContain("PKO");
    expect(text).toContain("107123.29");
    expect(text).toContain("4.25%");
    expect(text).toContain("XTB");
  });

  test("reports a balance that does not reconcile", async () => {
    createAccount({
      name: "PKO",
      balanceMinor: 600000,
      openingMinor: 100000,
      openedOn: "2026-07-31",
    });
    const text = (await listAssets()).content[0]?.text ?? "";
    expect(text).toContain("Does not reconcile");
  });
});

describe("record_asset", () => {
  beforeEach(resetTestDb);

  test("creates an account and names its id", async () => {
    const result = await recordAsset({
      action: "create_account",
      name: "PKO",
      balanceMinor: 10712329,
      openingMinor: 0,
    });
    // Not a fixed id: AUTOINCREMENT does not reset between tests, so assert the shape.
    expect(result.content[0]?.text).toMatch(/Recorded account #\d+: PKO/);
    expect(result.content[0]?.text).toContain("107123.29");
  });

  test("revalues an existing holding", async () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 463000 });
    const result = await recordAsset({
      action: "revalue",
      id: xtb.id,
      valueMinor: 590000,
      valuedAt: "2026-09-30",
    });
    expect(result.content[0]?.text).toContain("XTB");
    expect(result.content[0]?.text).toContain("590");
  });

  test("refuses to revalue a holding that does not exist", async () => {
    expect(
      recordAsset({ action: "revalue", id: 999, valueMinor: 1, valuedAt: "2026-09-30" }),
    ).rejects.toThrow("Holding not found: 999");
  });
});

describe("record_asset add_lot", () => {
  beforeEach(resetTestDb);

  test("records a purchase and names the holding", async () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    const result = await recordAsset({
      action: "add_lot",
      id: xtb.id,
      boughtOn: "2026-05-07",
      quantityMicro: 4382300,
      priceMinor: 15792,
      currency: "EUR",
      fxRate: 4248200,
      costMinor: 293998,
    });
    expect(result.content[0]?.text).toContain("XTB");
    expect(result.content[0]?.text).toContain("2939.98");
  });

  test("refuses a purchase with no holding", async () => {
    expect(
      recordAsset({
        action: "add_lot",
        boughtOn: "2026-05-07",
        quantityMicro: 1000000,
        priceMinor: 10000,
        costMinor: 40000,
      }),
    ).rejects.toThrow("add_lot needs the holding id");
  });
});
