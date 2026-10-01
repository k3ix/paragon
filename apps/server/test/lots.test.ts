import { describe, expect, test, beforeEach } from "bun:test";
import { db, schema, resetTestDb } from "./helpers/db";

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
