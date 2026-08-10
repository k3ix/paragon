import { describe, expect, it, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import { addTransactions } from "../src/services/transactions";
import { getPace } from "../src/services/pace";

beforeEach(() => {
  resetTestDb();
});

function expense(day: number, total: string) {
  addTransactions([
    { date: `2026-08-${String(day).padStart(2, "0")}`, total, merchant: `Shop ${day} ${total}` },
  ]);
}

/** Noon UTC on a day of August 2026, as Unix seconds. */
function august(day: number): number {
  return Math.floor(Date.UTC(2026, 7, day, 12) / 1000);
}

describe("pace", () => {
  it("divides spending by days elapsed, not days in the month", () => {
    expense(1, "300.00");
    expense(5, "300.00");

    const pace = getPace("2026-08", august(9));

    expect(pace.spentMinor).toBe(60000);
    expect(pace.daysElapsed).toBe(9);
    expect(pace.daysInMonth).toBe(31);
    expect(pace.daysRemaining).toBe(22);
    // 600.00 over nine days.
    expect(pace.perDayMinor).toBe(6667);
  });

  it("counts every day of a month that is already over", () => {
    const pace = getPace("2026-08", Math.floor(Date.UTC(2026, 8, 15) / 1000));

    expect(pace.daysElapsed).toBe(31);
    expect(pace.daysRemaining).toBe(0);
  });

  it("has no pace for a month that has not started", () => {
    const pace = getPace("2026-08", Math.floor(Date.UTC(2026, 6, 15) / 1000));

    expect(pace.daysElapsed).toBe(0);
    expect(pace.perDayMinor).toBeNull();
    expect(pace.projectedMinor).toBeNull();
  });

  it("extends the current pace across the whole month", () => {
    expense(1, "1000.00");

    const pace = getPace("2026-08", august(10));

    // 1000.00 over ten days is 100.00 a day, so 3100.00 across thirty-one.
    expect(pace.projectedMinor).toBe(310000);
  });

  it("counts the first day of the month as elapsed", () => {
    expense(1, "50.00");

    const pace = getPace("2026-08", august(1));

    expect(pace.daysElapsed).toBe(1);
    expect(pace.perDayMinor).toBe(5000);
  });

  it("has no budget to compare against until history exists", () => {
    expect(getPace("2026-08", august(9)).budgetMinor).toBeNull();
  });

  it("refuses an impossible month", () => {
    expect(() => getPace("2026-13")).toThrow(/Invalid month/);
  });
});
