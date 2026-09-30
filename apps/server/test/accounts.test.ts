import { describe, expect, test, beforeEach } from "bun:test";
import { db, schema, resetTestDb } from "./helpers/db";

describe("accounts schema", () => {
  beforeEach(resetTestDb);

  test("stores an account with a rate and a promo expiry", () => {
    db.insert(schema.accounts)
      .values({
        name: "PKO Konto Oszczędnościowe Plus",
        balanceMinor: 10712329,
        openingMinor: 9000000,
        openedOn: "2026-07-31",
        rateBp: 425,
        promoUntil: "2026-12-31",
      })
      .run();

    const row = db.select().from(schema.accounts).get();
    expect(row?.balanceMinor).toBe(10712329);
    expect(row?.rateBp).toBe(425);
    expect(row?.currency).toBe("PLN");
  });

  test("stores a holding whose value is not yet known", () => {
    db.insert(schema.holdings)
      .values({ name: "XTB", kind: "equity", investedMinor: 463000 })
      .run();

    const row = db.select().from(schema.holdings).get();
    expect(row?.investedMinor).toBe(463000);
    expect(row?.valueMinor).toBeNull();
    expect(row?.valuedAt).toBeNull();
  });
});
