import { describe, expect, test, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { createAccount, createHolding, revalueHolding, assetsSummary } from "../src/services/assets";

describe("assets summary", () => {
  beforeEach(resetTestDb);

  test("totals accounts and valued holdings together", () => {
    createAccount({ name: "PKO", balanceMinor: 10712329, openingMinor: 0 });
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 463000 });
    revalueHolding(xtb.id, 590000, "2026-09-30");

    const summary = assetsSummary();
    expect(summary.accountsTotalMinor).toBe(10712329);
    expect(summary.holdingsValueMinor).toBe(590000);
    expect(summary.totalMinor).toBe(10712329 + 590000);
  });

  test("reports growth in money and percent", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 400000 });
    revalueHolding(xtb.id, 500000, "2026-09-30");

    const holding = assetsSummary().holdings[0];
    expect(holding?.growthMinor).toBe(100000);
    expect(holding?.growthPercent).toBe(25);
  });

  // Review Focus 5: an unvalued holding must not read as a total loss.
  test("an unvalued holding counts at what was put in, not at zero", () => {
    createHolding({ name: "XTB", kind: "equity", investedMinor: 463000 });

    const summary = assetsSummary();
    expect(summary.holdingsValueMinor).toBe(463000);
    expect(summary.totalMinor).toBe(463000);
    expect(summary.holdings[0]?.growthMinor).toBeNull();
    expect(summary.holdings[0]?.growthPercent).toBeNull();
  });

  test("growth percent is null when nothing was invested", () => {
    const gift = createHolding({ name: "Подарочные акции", kind: "equity", investedMinor: 0 });
    revalueHolding(gift.id, 10000, "2026-09-30");
    expect(assetsSummary().holdings[0]?.growthPercent).toBeNull();
  });

  test("flags a valuation older than a month", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 400000 });
    revalueHolding(xtb.id, 500000, "2026-01-01");
    expect(assetsSummary().staleValuations.map((s) => s.name)).toEqual(["XTB"]);
  });

  test("flags a promotional rate expiring within a month", () => {
    const soon = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    createAccount({ name: "Millennium", balanceMinor: 100, openingMinor: 0, promoUntil: soon });
    expect(assetsSummary().expiringPromos.map((p) => p.name)).toEqual(["Millennium"]);
  });

  test("says nothing about a promotion that is months away", () => {
    const later = new Date(Date.now() + 200 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    createAccount({ name: "PKO", balanceMinor: 100, openingMinor: 0, promoUntil: later });
    expect(assetsSummary().expiringPromos).toHaveLength(0);
  });
});
