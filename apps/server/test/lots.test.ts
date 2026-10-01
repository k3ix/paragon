import { describe, expect, test, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { db, schema, resetTestDb } from "./helpers/db";
import {
  createHolding,
  listHoldings,
  revalueHolding,
  addLot,
  listLots,
  listValuations,
} from "../src/services/assets";

describe("lots and valuations schema", () => {
  beforeEach(resetTestDb);

  test("stores a purchase with its quantity, price and rate", () => {
    const holding = db
      .insert(schema.holdings)
      .values({ name: "XTB", kind: "equity" })
      .returning()
      .get();

    db.insert(schema.lots)
      .values({
        holdingId: holding.id,
        boughtOn: "2026-05-07",
        quantityMicro: 4382300,
        priceMinor: 15792,
        currency: "EUR",
        fxRate: 4248200,
        costMinor: 293998,
      })
      .run();

    const row = db.select().from(schema.lots).get();
    expect(row?.quantityMicro).toBe(4382300);
    expect(row?.priceMinor).toBe(15792);
    expect(row?.fxRate).toBe(4248200);
    expect(row?.costMinor).toBe(293998);
  });

  test("stores a valuation against a day", () => {
    const holding = db
      .insert(schema.holdings)
      .values({ name: "XTB", kind: "equity" })
      .returning()
      .get();

    db.insert(schema.valuations)
      .values({ holdingId: holding.id, valuedOn: "2026-09-30", valueMinor: 1485795 })
      .run();

    const row = db.select().from(schema.valuations).get();
    expect(row?.valueMinor).toBe(1485795);
    expect(row?.valuedOn).toBe("2026-09-30");
  });
});

describe("lots service", () => {
  beforeEach(resetTestDb);

  test("records a purchase and lists it", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    addLot({
      holdingId: xtb.id,
      boughtOn: "2026-05-07",
      quantityMicro: 4382300,
      priceMinor: 15792,
      currency: "EUR",
      fxRate: 4248200,
      costMinor: 293998,
    });

    const lots = listLots(xtb.id);
    expect(lots).toHaveLength(1);
    expect(lots[0]?.costMinor).toBe(293998);
  });

  test("lots are listed oldest first, so the story reads forwards", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    for (const day of ["2026-09-10", "2026-05-07", "2026-08-10"]) {
      addLot({
        holdingId: xtb.id,
        boughtOn: day,
        quantityMicro: 1000000,
        priceMinor: 16000,
        currency: "EUR",
        fxRate: 4300000,
        costMinor: 68800,
      });
    }
    expect(listLots(xtb.id).map((l) => l.boughtOn)).toEqual([
      "2026-05-07",
      "2026-08-10",
      "2026-09-10",
    ]);
  });

  // Review Focus 3: the broker's cost is the fact, not a derived figure.
  test("stores the stated cost even when it disagrees with the arithmetic", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    // 1.0 unit at 100.00 EUR at rate 4.0 would be 400.00; the broker charged 405.00.
    addLot({
      holdingId: xtb.id,
      boughtOn: "2026-05-07",
      quantityMicro: 1000000,
      priceMinor: 10000,
      currency: "EUR",
      fxRate: 4000000,
      costMinor: 40500,
    });
    expect(listLots(xtb.id)[0]?.costMinor).toBe(40500);
  });

  test("a lot does not move what was invested", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 300000 });
    addLot({
      holdingId: xtb.id,
      boughtOn: "2026-05-07",
      quantityMicro: 1000000,
      priceMinor: 10000,
      currency: "EUR",
      fxRate: 4000000,
      costMinor: 40000,
    });
    expect(listHoldings()[0]?.investedMinor).toBe(300000);
  });

  test("refuses a lot on a holding that does not exist", () => {
    expect(() =>
      addLot({
        holdingId: 999,
        boughtOn: "2026-05-07",
        quantityMicro: 1000000,
        priceMinor: 10000,
        currency: "EUR",
        fxRate: 4000000,
        costMinor: 40000,
      }),
    ).toThrow("Holding not found: 999");
  });
});

describe("valuation history", () => {
  beforeEach(resetTestDb);

  test("every revaluation is kept", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    revalueHolding(xtb.id, 1400000, "2026-08-31");
    revalueHolding(xtb.id, 1485795, "2026-09-30");

    expect(listValuations(xtb.id)).toEqual([
      expect.objectContaining({ valuedOn: "2026-08-31", valueMinor: 1400000 }),
      expect.objectContaining({ valuedOn: "2026-09-30", valueMinor: 1485795 }),
    ]);
  });

  // Review Focus 1: a same-day repeat is a correction, not a second fact.
  test("revaluing twice on one day replaces rather than accumulates", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    revalueHolding(xtb.id, 1400000, "2026-09-30");
    revalueHolding(xtb.id, 1485795, "2026-09-30");

    const history = listValuations(xtb.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.valueMinor).toBe(1485795);
  });

  // Review Focus 2: cascade, so a reused id cannot inherit a dead holding's history.
  test("deleting a holding takes its lots and valuations with it", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    addLot({
      holdingId: xtb.id,
      boughtOn: "2026-05-07",
      quantityMicro: 1000000,
      priceMinor: 10000,
      currency: "EUR",
      fxRate: 4000000,
      costMinor: 40000,
    });
    revalueHolding(xtb.id, 1485795, "2026-09-30");

    db.delete(schema.holdings).where(eq(schema.holdings.id, xtb.id)).run();

    expect(db.select().from(schema.lots).all()).toHaveLength(0);
    expect(db.select().from(schema.valuations).all()).toHaveLength(0);
  });
});

describe("addLot guards its inputs", () => {
  beforeEach(resetTestDb);

  test("refuses a non-integer quantity, price or cost", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    const base = {
      holdingId: xtb.id,
      boughtOn: "2026-05-07",
      quantityMicro: 1000000,
      priceMinor: 10000,
      currency: "EUR",
      fxRate: 4000000,
      costMinor: 40000,
    };
    expect(() => addLot({ ...base, quantityMicro: 4382300.7 })).toThrow("whole number");
    expect(() => addLot({ ...base, priceMinor: 15792.4 })).toThrow("whole number");
    expect(() => addLot({ ...base, costMinor: 293998.9 })).toThrow("whole number");
    expect(() => addLot({ ...base, fxRate: 4.2482 })).toThrow("whole number");
  });

  test("refuses a rate given in the wrong convention", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    // 4.2482 EUR/PLN in millionths is 4248200. A bare 4 is a million times too small.
    expect(() =>
      addLot({
        holdingId: xtb.id,
        boughtOn: "2026-05-07",
        quantityMicro: 1000000,
        priceMinor: 10000,
        currency: "EUR",
        fxRate: 4,
        costMinor: 40000,
      }),
    ).toThrow("millionths");
  });

  test("refuses a negative quantity or cost", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    const base = {
      holdingId: xtb.id,
      boughtOn: "2026-05-07",
      quantityMicro: 1000000,
      priceMinor: 10000,
      currency: "EUR",
      fxRate: 4000000,
      costMinor: 40000,
    };
    expect(() => addLot({ ...base, quantityMicro: -1000000 })).toThrow("positive");
    expect(() => addLot({ ...base, costMinor: -40000 })).toThrow("positive");
  });

  test("refuses a malformed purchase date", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    expect(() =>
      addLot({
        holdingId: xtb.id,
        boughtOn: "not-a-date",
        quantityMicro: 1000000,
        priceMinor: 10000,
        currency: "EUR",
        fxRate: 4000000,
        costMinor: 40000,
      }),
    ).toThrow("YYYY-MM-DD");
  });
});

describe("revaluing with an older date", () => {
  beforeEach(resetTestDb);

  test("backfilling an older figure does not overwrite the current one", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    revalueHolding(xtb.id, 1485795, "2026-09-30");
    const after = revalueHolding(xtb.id, 1400000, "2026-08-31");

    // The headline keeps the newest figure...
    expect(after.valueMinor).toBe(1485795);
    expect(after.valuedAt).toBe("2026-09-30");
    // ...and the older one still joins the history.
    expect(listValuations(xtb.id).map((v) => v.valuedOn)).toEqual([
      "2026-08-31",
      "2026-09-30",
    ]);
  });

  test("a newer figure does replace the headline", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    revalueHolding(xtb.id, 1400000, "2026-08-31");
    const after = revalueHolding(xtb.id, 1485795, "2026-09-30");
    expect(after.valueMinor).toBe(1485795);
    expect(after.valuedAt).toBe("2026-09-30");
  });
});
