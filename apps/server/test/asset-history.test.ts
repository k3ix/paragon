import { describe, expect, test, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { createAccount, createHolding, addLot, revalueHolding } from "../src/services/assets";
import { addTransactions } from "../src/services/transactions";
import { accountHistory, holdingHistory } from "../src/services/asset-history";
import { reconcileAccounts } from "../src/services/reconcile";

describe("account history", () => {
  beforeEach(resetTestDb);

  // Review Focus 4: nothing recorded yet must not crash the caller.
  test("an account with no movements has an empty history", () => {
    const pko = createAccount({
      name: "PKO",
      balanceMinor: 100000,
      openingMinor: 100000,
      openedOn: "2026-07-31",
    });
    expect(accountHistory(pko.id).movements).toEqual([]);
  });

  test("movements come back oldest first with a running balance", () => {
    const pko = createAccount({
      name: "PKO",
      balanceMinor: 1400000,
      openingMinor: 100000,
      openedOn: "2026-07-31",
    });
    addTransactions([
      { date: "2026-08-10", total: "4000.00", type: "transfer", toAccountId: pko.id },
      { date: "2026-09-10", total: "9000.00", type: "transfer", toAccountId: pko.id },
    ]);

    const movements = accountHistory(pko.id).movements;
    expect(movements.map((m) => m.runningMinor)).toEqual([500000, 1400000]);
  });

  // Review Focus 5: a withdrawal is a negative transfer, not a separate direction.
  test("a negative transfer lowers the running balance", () => {
    const pko = createAccount({
      name: "PKO",
      balanceMinor: 300000,
      openingMinor: 400000,
      openedOn: "2026-07-31",
    });
    addTransactions([
      { date: "2026-09-21", total: "-1000.00", type: "transfer", toAccountId: pko.id },
    ]);
    expect(accountHistory(pko.id).movements[0]?.runningMinor).toBe(300000);
  });

  test("money leaving the account lowers it too", () => {
    const pko = createAccount({
      name: "PKO",
      balanceMinor: 300000,
      openingMinor: 400000,
      openedOn: "2026-07-31",
    });
    addTransactions([
      { date: "2026-09-21", total: "1000.00", type: "transfer", fromAccountId: pko.id },
    ]);
    expect(accountHistory(pko.id).movements[0]?.runningMinor).toBe(300000);
  });

  test("another account's movements do not leak in", () => {
    const a = createAccount({ name: "A", balanceMinor: 0, openingMinor: 0 });
    const b = createAccount({ name: "B", balanceMinor: 0, openingMinor: 0 });
    addTransactions([
      { date: "2026-09-10", total: "100.00", type: "transfer", toAccountId: b.id },
    ]);
    expect(accountHistory(a.id).movements).toEqual([]);
  });
});

describe("holding history", () => {
  beforeEach(resetTestDb);

  test("carries movements, purchases and valuations together", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    addTransactions([
      { date: "2026-09-10", total: "4630.00", type: "transfer", toHoldingId: xtb.id },
    ]);
    addLot({
      holdingId: xtb.id,
      boughtOn: "2026-09-10",
      quantityMicro: 6293300,
      priceMinor: 16616,
      currency: "EUR",
      fxRate: 4341700,
      costMinor: 454009,
    });
    revalueHolding(xtb.id, 1485795, "2026-09-30");

    const history = holdingHistory(xtb.id);
    expect(history.movements).toHaveLength(1);
    expect(history.lots).toHaveLength(1);
    expect(history.valuations).toHaveLength(1);
  });
});

describe("history and reconciliation agree", () => {
  beforeEach(resetTestDb);

  test("a movement dated before the account opened is excluded, as reconciliation excludes it", () => {
    const pko = createAccount({
      name: "PKO",
      balanceMinor: 500000,
      openingMinor: 100000,
      openedOn: "2026-07-31",
    });
    addTransactions([
      // Predates the opening figure, which already contains it.
      { date: "2026-05-07", total: "3000.00", type: "transfer", toAccountId: pko.id },
      { date: "2026-08-10", total: "4000.00", type: "transfer", toAccountId: pko.id },
    ]);

    const movements = accountHistory(pko.id).movements;
    expect(movements).toHaveLength(1);
    expect(movements[0]?.runningMinor).toBe(500000);
    // The running total agrees with the stated balance, so reconciliation stays silent
    // for the same reason — the two can no longer disagree on screen.
    expect(reconcileAccounts()).toHaveLength(0);
  });
});
