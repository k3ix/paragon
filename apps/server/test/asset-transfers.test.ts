import { describe, expect, test, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { createAccount, createHolding } from "../src/services/assets";
import { addTransactions } from "../src/services/transactions";

describe("transfers that name assets", () => {
  beforeEach(resetTestDb);

  test("records which account money went to", () => {
    const savings = createAccount({ name: "PKO", balanceMinor: 0, openingMinor: 0 });
    const result = addTransactions([
      { date: "2026-09-10", total: "4000.00", type: "transfer", toAccountId: savings.id },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("created");
  });

  test("records money moved into a holding", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    const result = addTransactions([
      { date: "2026-09-10", total: "4630.00", type: "transfer", toHoldingId: xtb.id },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("created");
  });

  // Review Focus 1: an account and a holding on the same side is incoherent.
  test("refuses a transfer naming both an account and a holding as destination", () => {
    const savings = createAccount({ name: "PKO", balanceMinor: 0, openingMinor: 0 });
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    expect(() =>
      addTransactions([
        {
          date: "2026-09-10",
          total: "100.00",
          type: "transfer",
          toAccountId: savings.id,
          toHoldingId: xtb.id,
        },
      ]),
    ).toThrow("cannot name both an account and a holding");
  });

  // Review Focus 2: a self-transfer reconciles as a no-op but looks like movement.
  test("refuses a transfer from an account to itself", () => {
    const savings = createAccount({ name: "PKO", balanceMinor: 0, openingMinor: 0 });
    expect(() =>
      addTransactions([
        {
          date: "2026-09-10",
          total: "100.00",
          type: "transfer",
          fromAccountId: savings.id,
          toAccountId: savings.id,
        },
      ]),
    ).toThrow("cannot move money to the account it came from");
  });

  test("refuses an account that does not exist", () => {
    expect(() =>
      addTransactions([
        { date: "2026-09-10", total: "100.00", type: "transfer", toAccountId: 999 },
      ]),
    ).toThrow("Account not found: 999");
  });
});
