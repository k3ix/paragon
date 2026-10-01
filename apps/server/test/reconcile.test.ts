import { describe, expect, test, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { createAccount } from "../src/services/assets";
import { addTransactions } from "../src/services/transactions";
import { reconcileAccounts } from "../src/services/reconcile";

describe("reconciliation", () => {
  beforeEach(resetTestDb);

  test("says nothing when movements explain the balance", () => {
    const pko = createAccount({
      name: "PKO",
      balanceMinor: 500000,
      openingMinor: 100000,
      openedOn: "2026-07-31",
    });
    addTransactions([
      { date: "2026-09-10", total: "4000.00", type: "transfer", toAccountId: pko.id },
    ]);
    expect(reconcileAccounts()).toHaveLength(0);
  });

  test("reports the gap when a movement is missing", () => {
    const pko = createAccount({
      name: "PKO",
      balanceMinor: 600000,
      openingMinor: 100000,
      openedOn: "2026-07-31",
    });
    addTransactions([
      { date: "2026-09-10", total: "4000.00", type: "transfer", toAccountId: pko.id },
    ]);

    const gaps = reconcileAccounts();
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.expectedMinor).toBe(500000);
    expect(gaps[0]?.statedMinor).toBe(600000);
    expect(gaps[0]?.differenceMinor).toBe(100000);
  });

  test("counts money leaving the account against it", () => {
    const pko = createAccount({
      name: "PKO",
      balanceMinor: 0,
      openingMinor: 100000,
      openedOn: "2026-07-31",
    });
    addTransactions([
      { date: "2026-09-21", total: "1000.00", type: "transfer", fromAccountId: pko.id },
    ]);
    expect(reconcileAccounts()).toHaveLength(0);
  });

  test("counts interest credited to the account", () => {
    const pko = createAccount({
      name: "PKO",
      balanceMinor: 138000,
      openingMinor: 100000,
      openedOn: "2026-07-31",
    });
    addTransactions([
      {
        date: "2026-09-30",
        total: "380.00",
        type: "income",
        startsPeriod: false,
        toAccountId: pko.id,
      },
    ]);
    expect(reconcileAccounts()).toHaveLength(0);
  });

  test("ignores movements dated before the account opened", () => {
    const pko = createAccount({
      name: "PKO",
      balanceMinor: 100000,
      openingMinor: 100000,
      openedOn: "2026-08-01",
    });
    addTransactions([
      { date: "2026-07-01", total: "9999.00", type: "transfer", toAccountId: pko.id },
    ]);
    expect(reconcileAccounts()).toHaveLength(0);
  });

  test("skips an account with no opening date rather than inventing a gap", () => {
    createAccount({ name: "Без даты", balanceMinor: 555000, openingMinor: 0 });
    expect(reconcileAccounts()).toHaveLength(0);
  });

  // Review Focus 4: an account with no movements reconciles against its opening figure.
  test("an account with no movements is clean, not a gap", () => {
    createAccount({
      name: "Наличка",
      balanceMinor: 250000,
      openingMinor: 250000,
      openedOn: "2026-07-31",
    });
    expect(reconcileAccounts()).toHaveLength(0);
  });
});
