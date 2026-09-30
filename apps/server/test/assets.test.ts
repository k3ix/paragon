import { describe, expect, test, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { db, schema, resetTestDb } from "./helpers/db";
import {
  listAccounts,
  createAccount,
  updateAccount,
  listHoldings,
  createHolding,
  revalueHolding,
} from "../src/services/assets";

describe("assets", () => {
  beforeEach(resetTestDb);

  test("creates and lists an account", () => {
    createAccount({ name: "PKO", balanceMinor: 10712329, openingMinor: 0, rateBp: 425 });
    const all = listAccounts();
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe("PKO");
    expect(all[0]?.rateBp).toBe(425);
  });

  test("archived accounts stay out of the list", () => {
    const account = createAccount({ name: "Old", balanceMinor: 0, openingMinor: 0 });
    updateAccount(account.id, { archived: true });
    expect(listAccounts()).toHaveLength(0);
  });

  test("revaluing a holding records the value and the day", () => {
    const holding = createHolding({ name: "XTB", kind: "equity", investedMinor: 463000 });
    const updated = revalueHolding(holding.id, 590000, "2026-09-30");
    expect(updated.valueMinor).toBe(590000);
    expect(updated.valuedAt).toBe("2026-09-30");
  });

  test("a holding starts with no valuation rather than a zero one", () => {
    const holding = createHolding({ name: "DOR", kind: "bond", investedMinor: 100000 });
    expect(holding.valueMinor).toBeNull();
  });

  test("an unknown id is refused rather than silently ignored", () => {
    expect(() => revalueHolding(999, 100, "2026-09-30")).toThrow("Holding not found: 999");
  });

  test("listing holdings narrows the kind", () => {
    createHolding({ name: "DOR", kind: "bond", investedMinor: 100000 });
    expect(listHoldings()[0]?.kind).toBe("bond");
  });

  // Review Focus 3: an account still referenced by a transaction cannot be deleted.
  test("deleting an account that transactions reference is refused", () => {
    const account = createAccount({ name: "PKO", balanceMinor: 0, openingMinor: 0 });
    db.insert(schema.transactions)
      .values({
        occurredOn: 1789689600,
        type: "transfer",
        totalMinor: 100000,
        toAccountId: account.id,
        dedupHash: "reconcile-fk-test",
      })
      .run();

    expect(() =>
      db.delete(schema.accounts).where(eq(schema.accounts.id, account.id)).run(),
    ).toThrow();
  });
});
