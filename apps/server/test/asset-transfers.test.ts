import { describe, expect, test, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import {
  createAccount,
  createHolding,
  listHoldings,
  revalueHolding,
  assetsSummary,
} from "../src/services/assets";
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

  test("refuses a transfer naming both an account and a holding as source", () => {
    const savings = createAccount({ name: "PKO", balanceMinor: 0, openingMinor: 0 });
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    expect(() =>
      addTransactions([
        {
          date: "2026-09-10",
          total: "100.00",
          type: "transfer",
          fromAccountId: savings.id,
          fromHoldingId: xtb.id,
        },
      ]),
    ).toThrow("cannot name both an account and a holding");
  });

  test("refuses a transfer from a holding to itself", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 0 });
    expect(() =>
      addTransactions([
        {
          date: "2026-09-10",
          total: "100.00",
          type: "transfer",
          fromHoldingId: xtb.id,
          toHoldingId: xtb.id,
        },
      ]),
    ).toThrow("cannot move money to the holding it came from");
  });

  test("refuses a holding that does not exist", () => {
    expect(() =>
      addTransactions([
        { date: "2026-09-10", total: "100.00", type: "transfer", toHoldingId: 999 },
      ]),
    ).toThrow("Holding not found: 999");
  });

  test("refuses an account that does not exist", () => {
    expect(() =>
      addTransactions([
        { date: "2026-09-10", total: "100.00", type: "transfer", toAccountId: 999 },
      ]),
    ).toThrow("Account not found: 999");
  });
});

describe("transfers move what is invested", () => {
  beforeEach(resetTestDb);

  test("money into a holding raises what was invested", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 463000 });
    addTransactions([
      { date: "2026-09-10", total: "1000.00", type: "transfer", toHoldingId: xtb.id },
    ]);
    expect(listHoldings()[0]?.investedMinor).toBe(563000);
  });

  test("money out of a holding lowers it", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 463000 });
    addTransactions([
      { date: "2026-09-10", total: "3000.00", type: "transfer", fromHoldingId: xtb.id },
    ]);
    expect(listHoldings()[0]?.investedMinor).toBe(163000);
  });

  test("growth is measured against everything put in, not just the first amount", () => {
    const xtb = createHolding({ name: "XTB", kind: "equity", investedMinor: 463000 });
    addTransactions([
      { date: "2026-09-10", total: "1000.00", type: "transfer", toHoldingId: xtb.id },
    ]);
    revalueHolding(xtb.id, 580000, "2026-09-30");

    const holding = assetsSummary().holdings[0];
    // 5800 against 5630 put in, not against the 4630 it opened with.
    expect(holding?.growthMinor).toBe(17000);
    expect(holding?.growthPercent).toBe(3);
  });

  test("a transfer from an account into a holding leaves the total unchanged", () => {
    const card = createAccount({
      name: "Сбережения",
      balanceMinor: 500000,
      openingMinor: 500000,
      openedOn: "2026-07-31",
    });
    const dor = createHolding({ name: "DOR", kind: "bond", investedMinor: 0 });

    const before = assetsSummary().totalMinor;
    addTransactions([
      {
        date: "2026-09-10",
        total: "5000.00",
        type: "transfer",
        fromAccountId: card.id,
        toHoldingId: dor.id,
      },
    ]);

    // The account balance is what the bank says and is not moved by us; the holding
    // rises, so the money is now counted once on each side rather than vanishing.
    expect(assetsSummary().holdingsInvestedMinor).toBe(500000);
    expect(assetsSummary().totalMinor).toBe(before + 500000);
  });
});
