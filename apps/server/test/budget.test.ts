import { describe, expect, it, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { createCategory } from "../src/services/categories";
import { addTransactions } from "../src/services/transactions";
import { createCommitment, endCommitment } from "../src/services/commitments";
import { getBudget } from "../src/services/budget";

beforeEach(() => {
  resetTestDb();
});

/** The declared salary every test that expects a figure needs. */
function baseIncome() {
  createCommitment({
    kind: "income",
    name: "Зарплата",
    amountMinor: 2800000,
    activeFrom: "2026-01",
  });
}

function expense(month: string, total: string, category?: string) {
  addTransactions([
    {
      date: `${month}-15`,
      total,
      merchant: `Shop ${month} ${total}`,
      ...(category ? { lineItems: [{ amount: total, category }] } : {}),
    },
  ]);
}

describe("budget", () => {
  it("cannot name a figure before the salary is declared", () => {
    const budget = getBudget("2026-08");

    expect(budget.baseIncomeMinor).toBeNull();
    expect(budget.setAsideMinor).toBeNull();
    expect(budget.reason).toBe("no-base-income");
  });

  it("waits for three completed months before averaging", () => {
    baseIncome();
    createCategory({ name: "Еда" });
    expense("2026-07", "1000.00", "Еда");
    expense("2026-08", "1000.00", "Еда");

    const budget = getBudget("2026-08");

    expect(budget.baseIncomeMinor).toBe(2800000);
    expect(budget.flexibleAverageMinor).toBeNull();
    expect(budget.setAsideMinor).toBeNull();
    expect(budget.reason).toBe("not-enough-history");
    // Only 2026-07 is a completed month with spending, so two more are needed.
    expect(budget.monthsObserved).toBe(1);
    expect(budget.monthsNeeded).toBe(2);
  });

  it("subtracts commitments and the average from base income", () => {
    baseIncome();
    createCommitment({
      kind: "expense",
      name: "Аренда",
      amountMinor: 400000,
      activeFrom: "2026-01",
    });
    createCategory({ name: "Еда" });
    expense("2026-05", "900.00", "Еда");
    expense("2026-06", "1100.00", "Еда");
    expense("2026-07", "1000.00", "Еда");

    const budget = getBudget("2026-08");

    expect(budget.committedMinor).toBe(400000);
    expect(budget.flexibleAverageMinor).toBe(100000);
    // 2 800 000 − 400 000 − 100 000
    expect(budget.setAsideMinor).toBe(2300000);
    expect(budget.reason).toBeNull();
  });

  it("never averages the current month, which is only partly spent", () => {
    baseIncome();
    createCategory({ name: "Еда" });
    expense("2026-05", "1000.00", "Еда");
    expense("2026-06", "1000.00", "Еда");
    expense("2026-07", "1000.00", "Еда");
    // Nine days into the current month, far below a whole one.
    expense("2026-08", "10.00", "Еда");

    expect(getBudget("2026-08").flexibleAverageMinor).toBe(100000);
  });

  it("does not count a committed category twice", () => {
    baseIncome();
    const rent = createCategory({ name: "Аренда" });
    createCategory({ name: "Еда" });
    createCommitment({
      kind: "expense",
      name: "Аренда",
      amountMinor: 400000,
      categoryId: rent.id,
      activeFrom: "2026-01",
    });

    for (const month of ["2026-05", "2026-06", "2026-07"]) {
      expense(month, "1000.00", "Еда");
      expense(month, "4000.00", "Аренда");
    }

    const budget = getBudget("2026-08");

    // Rent is already committed, so only the food spending is averaged.
    expect(budget.flexibleAverageMinor).toBe(100000);
    expect(budget.setAsideMinor).toBe(2300000);
  });

  it("keeps uncategorized spending in the average", () => {
    baseIncome();
    const rent = createCategory({ name: "Аренда" });
    createCommitment({
      kind: "expense",
      name: "Аренда",
      amountMinor: 400000,
      categoryId: rent.id,
      activeFrom: "2026-01",
    });

    // A line with no category cannot be the committed one, so dropping it would
    // understate what a month actually costs.
    for (const month of ["2026-05", "2026-06", "2026-07"]) {
      expense(month, "500.00");
    }

    expect(getBudget("2026-08").flexibleAverageMinor).toBe(50000);
  });

  it("uses the three most recent months, not the oldest three", () => {
    baseIncome();
    createCategory({ name: "Еда" });
    // An expensive spell well in the past, then three cheaper months.
    expense("2026-02", "5000.00", "Еда");
    expense("2026-05", "1000.00", "Еда");
    expense("2026-06", "1000.00", "Еда");
    expense("2026-07", "1000.00", "Еда");

    expect(getBudget("2026-08").flexibleAverageMinor).toBe(100000);
  });

  it("counts a commitment only while it applies", () => {
    baseIncome();
    const rent = createCommitment({
      kind: "expense",
      name: "Аренда",
      amountMinor: 400000,
      activeFrom: "2026-01",
    });

    expect(getBudget("2026-08").committedMinor).toBe(400000);

    // Moved out in June, so August no longer owes rent — but May still does.
    endCommitment(rent.id, "2026-06");

    expect(getBudget("2026-08").committedMinor).toBe(0);
    expect(getBudget("2026-05").committedMinor).toBe(400000);
  });

  it("refuses an impossible month", () => {
    expect(() => getBudget("2026-13")).toThrow(/Invalid month/);
  });
});
