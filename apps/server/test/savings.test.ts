import { describe, expect, it, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { createCategory } from "../src/services/categories";
import { addTransactions } from "../src/services/transactions";
import { getSavings, getRunway } from "../src/services/savings";

beforeEach(() => {
  resetTestDb();
});

function seedTree() {
  const savings = createCategory({ name: "Накопления" });
  createCategory({ name: "Акции", parentId: savings.id });
  createCategory({ name: "Сберегательный", parentId: savings.id });
  createCategory({ name: "Еда" });
}

function transfer(date: string, total: string, category: string, merchant: string) {
  addTransactions([
    { date, total, type: "transfer", merchant, lineItems: [{ amount: total, category }] },
  ]);
}

function income(date: string, total: string) {
  addTransactions([{ date, total, type: "income", merchant: `Salary ${date} ${total}` }]);
}

function expense(date: string, total: string, category: string) {
  addTransactions([
    {
      date,
      total,
      merchant: `Shop ${date} ${total}`,
      lineItems: [{ amount: total, category }],
    },
  ]);
}

describe("savings", () => {
  it("counts transfers, not expenses", () => {
    seedTree();
    transfer("2026-08-10", "4000.00", "Накопления/Акции", "Акции");
    expense("2026-08-11", "500.00", "Еда");

    expect(getSavings("2026-08").savedMinor).toBe(400000);
  });

  it("groups two payments into one destination", () => {
    seedTree();
    transfer("2026-08-10", "4000.00", "Накопления/Сберегательный", "Сберегательный счёт");
    transfer("2026-08-20", "10000.00", "Накопления/Сберегательный", "Сберегательный счёт");

    const savings = getSavings("2026-08");

    expect(savings.destinations).toEqual([
      { label: "Сберегательный", amountMinor: 1400000 },
    ]);
  });

  it("sorts destinations biggest first", () => {
    seedTree();
    transfer("2026-08-10", "2750.00", "Накопления/Акции", "Акции");
    transfer("2026-08-10", "14000.00", "Накопления/Сберегательный", "Сберегательный счёт");

    expect(getSavings("2026-08").destinations.map((d) => d.label)).toEqual([
      "Сберегательный",
      "Акции",
    ]);
  });

  it("reports the share of income that was saved", () => {
    seedTree();
    income("2026-08-10", "28030.00");
    transfer("2026-08-10", "14015.00", "Накопления/Акции", "Акции");

    expect(getSavings("2026-08").rate).toBe(50);
  });

  it("has no rate when no income is recorded", () => {
    seedTree();
    transfer("2026-08-10", "4000.00", "Накопления/Акции", "Акции");

    expect(getSavings("2026-08").rate).toBeNull();
  });

  it("compares against the previous month", () => {
    seedTree();
    transfer("2026-07-10", "5000.00", "Накопления/Акции", "Акции");
    transfer("2026-08-10", "8000.00", "Накопления/Акции", "Акции");

    expect(getSavings("2026-08").previousMinor).toBe(500000);
  });

  it("returns six months of history ending with the current one", () => {
    seedTree();
    transfer("2026-08-10", "8000.00", "Накопления/Акции", "Акции");

    const history = getSavings("2026-08").history;

    expect(history).toHaveLength(6);
    expect(history.at(-1)).toEqual({ month: "2026-08", savedMinor: 800000 });
    expect(history[0]!.month).toBe("2026-03");
  });

  it("falls back to the merchant when a transfer has no category", () => {
    addTransactions([
      { date: "2026-08-10", total: "1000.00", type: "transfer", merchant: "Брокер" },
    ]);

    expect(getSavings("2026-08").destinations).toEqual([
      { label: "Брокер", amountMinor: 100000 },
    ]);
  });

  it("refuses an impossible month", () => {
    expect(() => getSavings("2026-13")).toThrow(/Invalid month/);
  });
});

describe("runway", () => {
  it("subtracts both savings and spending from income", () => {
    seedTree();
    income("2026-08-10", "28030.00");
    transfer("2026-08-10", "14000.00", "Накопления/Акции", "Акции");
    expense("2026-08-11", "1000.00", "Еда");

    const runway = getRunway("2026-08");

    expect(runway.incomeMinor).toBe(2803000);
    expect(runway.savedMinor).toBe(1400000);
    expect(runway.spentMinor).toBe(100000);
    expect(runway.leftMinor).toBe(1303000);
  });

  it("reports a negative figure when more went out than came in", () => {
    seedTree();
    income("2026-08-10", "1000.00");
    expense("2026-08-11", "1500.00", "Еда");

    expect(getRunway("2026-08").leftMinor).toBe(-50000);
  });

  it("refuses an impossible month", () => {
    expect(() => getRunway("2026-13")).toThrow(/Invalid month/);
  });
});
