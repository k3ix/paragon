import { describe, expect, it, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { createCategory } from "../src/services/categories";
import { addTransactions } from "../src/services/transactions";
import { payPeriods, resolvePeriod } from "../src/services/periods";
import { listTransactions } from "../src/services/queries";
import { getCategoryTreeForRange } from "../src/services/summary";
import { getPeriodSummary } from "../src/services/period-summary";

beforeEach(() => {
  resetTestDb();
});

/** Noon UTC on a day, as Unix seconds. */
function at(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day, 12) / 1000);
}

function salary(date: string, total: string) {
  addTransactions([{ date, total, type: "income", merchant: `Зарплата ${date}` }]);
}

function expense(date: string, total: string, category?: string) {
  addTransactions([
    {
      date,
      total,
      merchant: `Shop ${date} ${total}`,
      ...(category ? { lineItems: [{ amount: total, category }] } : {}),
    },
  ]);
}

function saved(date: string, total: string, merchant: string) {
  addTransactions([{ date, total, type: "transfer", merchant }]);
}

describe("pay periods", () => {
  it("has none until a salary is recorded", () => {
    expect(payPeriods(at(2026, 8, 10))).toEqual([]);
  });

  it("runs from one salary to the day before the next", () => {
    salary("2026-07-10", "28000.00");
    salary("2026-08-05", "28030.00");

    const periods = payPeriods(at(2026, 8, 20));

    expect(periods).toHaveLength(2);
    // Newest first.
    expect(periods[0]!.id).toBe("pay-2026-08-05");
    expect(periods[1]!.id).toBe("pay-2026-07-10");
    expect(periods[1]!.end).toBe(periods[0]!.start);
  });

  it("marks only the newest period open", () => {
    salary("2026-07-10", "28000.00");
    salary("2026-08-05", "28030.00");

    const periods = payPeriods(at(2026, 8, 20));

    expect(periods[0]!.open).toBe(true);
    expect(periods[1]!.open).toBe(false);
  });

  it("handles a payday that moves between months", () => {
    salary("2026-06-12", "28000.00");
    salary("2026-07-03", "28000.00");
    salary("2026-08-10", "28030.00");

    const periods = payPeriods(at(2026, 8, 20));

    expect(periods.map((p) => p.id)).toEqual(["pay-2026-08-10", "pay-2026-07-03", "pay-2026-06-12"]);
  });

  it("gives a salary recorded today a period rather than an empty range", () => {
    salary("2026-08-10", "28030.00");

    const periods = payPeriods(at(2026, 8, 10));

    expect(periods[0]!.end).toBeGreaterThan(periods[0]!.start);
  });

  it("ignores a short period when estimating how long the open one runs", () => {
    // A salary back-dated to balance earlier spending makes a ten-day period. Taking
    // it as typical would claim the current money has to last ten days.
    salary("2026-07-31", "16280.40");
    salary("2026-08-10", "28030.00");

    expect(payPeriods(at(2026, 8, 11))[0]!.expectedDays).toBe(30);
  });

  it("estimates from full-length periods once there are some", () => {
    salary("2026-06-10", "28000.00");
    salary("2026-07-10", "28000.00");
    salary("2026-08-09", "28000.00");

    // Thirty days then thirty, so the open period is expected to run thirty.
    expect(payPeriods(at(2026, 8, 11))[0]!.expectedDays).toBe(30);
  });

  it("resolves a month id to calendar bounds", () => {
    const period = resolvePeriod("2026-08", at(2026, 8, 20));

    expect(period.kind).toBe("month");
    expect(period.id).toBe("2026-08");
  });

  it("resolves a date id to its pay period", () => {
    salary("2026-08-10", "28030.00");

    expect(resolvePeriod("pay-2026-08-10", at(2026, 8, 20)).kind).toBe("pay");
  });

  it("refuses a date with no pay period", () => {
    expect(() => resolvePeriod("pay-2026-08-10", at(2026, 8, 20))).toThrow(/No pay period/);
  });

  it("refuses a malformed id", () => {
    expect(() => resolvePeriod("august", at(2026, 8, 20))).toThrow(/Invalid period/);
  });
});

describe("period summary", () => {
  it("keeps a pay period's income, savings and spending together", () => {
    createCategory({ name: "Еда" });
    salary("2026-08-10", "28030.00");
    saved("2026-08-10", "14000.00", "Сберегательный счёт");
    expense("2026-08-12", "500.00", "Еда");

    const summary = getPeriodSummary("pay-2026-08-10", at(2026, 8, 20));

    expect(summary.incomeMinor).toBe(2803000);
    expect(summary.savedMinor).toBe(1400000);
    expect(summary.spentMinor).toBe(50000);
    expect(summary.leftMinor).toBe(1353000);
  });

  it("excludes spending that belongs to the previous paycheque", () => {
    createCategory({ name: "Еда" });
    salary("2026-07-10", "28000.00");
    // Spent while living on July's salary.
    expense("2026-08-02", "900.00", "Еда");
    salary("2026-08-10", "28030.00");
    expense("2026-08-12", "100.00", "Еда");

    const august = getPeriodSummary("pay-2026-08-10", at(2026, 8, 20));

    // Only the spending after the new salary counts against it.
    expect(august.spentMinor).toBe(10000);
    // The calendar month would have lumped both together.
    expect(getPeriodSummary("2026-08", at(2026, 8, 20)).spentMinor).toBe(100000);
  });

  it("divides what is left across the days still to come", () => {
    salary("2026-08-10", "28030.00");
    saved("2026-08-10", "20000.00", "Сберегательный счёт");

    const summary = getPeriodSummary("pay-2026-08-10", at(2026, 8, 10));

    expect(summary.leftMinor).toBe(803000);
    expect(summary.perDayLeftMinor).not.toBeNull();
  });

  it("splits spending into committed, occasional and living", () => {
    createCategory({ name: "Путешествия", isOccasional: true });
    createCategory({ name: "Еда" });
    salary("2026-08-10", "28030.00");
    expense("2026-08-11", "3000.00", "Путешествия");
    expense("2026-08-12", "200.00", "Еда");

    const summary = getPeriodSummary("pay-2026-08-10", at(2026, 8, 20));

    expect(summary.occasionalMinor).toBe(300000);
    expect(summary.livingMinor).toBe(20000);
    expect(summary.committedMinor + summary.occasionalMinor + summary.livingMinor).toBe(
      summary.spentMinor,
    );
  });

  it("measures the daily rate against living costs", () => {
    createCategory({ name: "Путешествия", isOccasional: true });
    createCategory({ name: "Еда" });
    salary("2026-08-10", "28030.00");
    expense("2026-08-11", "3000.00", "Путешествия");
    expense("2026-08-12", "500.00", "Еда");

    // Five days elapsed, 500.00 of ordinary spending.
    const summary = getPeriodSummary("pay-2026-08-10", at(2026, 8, 14));

    expect(summary.daysElapsed).toBe(5);
    expect(summary.perDayMinor).toBe(10000);
  });

  it("filters the transaction list to the period", () => {
    createCategory({ name: "Еда" });
    salary("2026-07-10", "28000.00");
    expense("2026-08-02", "900.00", "Еда");
    salary("2026-08-10", "28030.00");
    expense("2026-08-12", "100.00", "Еда");

    const rows = listTransactions({ period: "pay-2026-08-10", now: at(2026, 8, 20) }).rows;

    // The salary that opens the period plus the one purchase after it.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.type).sort()).toEqual(["expense", "income"]);
  });

  it("filters the category tree to the period", () => {
    createCategory({ name: "Еда" });
    salary("2026-07-10", "28000.00");
    expense("2026-08-02", "900.00", "Еда");
    salary("2026-08-10", "28030.00");
    expense("2026-08-12", "100.00", "Еда");

    const { start, end } = resolvePeriod("pay-2026-08-10", at(2026, 8, 20));
    const tree = getCategoryTreeForRange(start, end);

    // Only the 100.00 spent after the new salary, not August's earlier 900.00.
    expect(tree.find((n) => n.name === "Еда")!.totalMinor).toBe(10000);
  });

  it("still reports a calendar month", () => {
    createCategory({ name: "Еда" });
    expense("2026-08-02", "100.00", "Еда");

    const summary = getPeriodSummary("2026-08", at(2026, 8, 20));

    expect(summary.period.kind).toBe("month");
    expect(summary.spentMinor).toBe(10000);
  });
});
