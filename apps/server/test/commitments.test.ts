import { describe, expect, it, beforeEach } from "bun:test";
import { resetTestDb } from "./helpers/db";
import {
  createCommitment,
  listCommitments,
  updateCommitment,
  endCommitment,
  commitmentsForMonth,
} from "../src/services/commitments";

beforeEach(() => {
  resetTestDb();
});

describe("commitments", () => {
  it("applies from its start month onward", () => {
    createCommitment({
      kind: "expense",
      name: "Аренда",
      amountMinor: 400000,
      activeFrom: "2026-08",
    });

    expect(commitmentsForMonth("2026-07")).toHaveLength(0);
    expect(commitmentsForMonth("2026-08")).toHaveLength(1);
    expect(commitmentsForMonth("2026-12")).toHaveLength(1);
  });

  it("stops applying after the month it was ended in", () => {
    const rent = createCommitment({
      kind: "expense",
      name: "Аренда",
      amountMinor: 400000,
      activeFrom: "2026-01",
    });
    endCommitment(rent.id, "2026-06");

    expect(commitmentsForMonth("2026-06")).toHaveLength(1);
    expect(commitmentsForMonth("2026-07")).toHaveLength(0);
  });

  it("keeps past months on the old amount when a cost changes", () => {
    const old = createCommitment({
      kind: "expense",
      name: "Аренда",
      amountMinor: 400000,
      activeFrom: "2026-01",
    });
    endCommitment(old.id, "2026-06");
    createCommitment({
      kind: "expense",
      name: "Аренда",
      amountMinor: 450000,
      activeFrom: "2026-07",
    });

    expect(commitmentsForMonth("2026-05")[0]!.amountMinor).toBe(400000);
    expect(commitmentsForMonth("2026-08")[0]!.amountMinor).toBe(450000);
  });

  it("refuses an impossible month", () => {
    expect(() =>
      createCommitment({
        kind: "expense",
        name: "Аренда",
        amountMinor: 400000,
        activeFrom: "2026-13",
      }),
    ).toThrow(/Invalid month/);
  });

  it("refuses a range that ends before it starts", () => {
    expect(() =>
      createCommitment({
        kind: "expense",
        name: "Аренда",
        amountMinor: 400000,
        activeFrom: "2026-08",
        activeTo: "2026-07",
      }),
    ).toThrow(/before it starts/);
  });

  it("refuses a non-positive amount", () => {
    expect(() =>
      createCommitment({
        kind: "expense",
        name: "Аренда",
        amountMinor: 0,
        activeFrom: "2026-08",
      }),
    ).toThrow(/must be positive/);
  });

  it("lists every row regardless of whether it still applies", () => {
    const salary = createCommitment({
      kind: "income",
      name: "Зарплата",
      amountMinor: 2800000,
      activeFrom: "2026-01",
    });
    endCommitment(salary.id, "2026-03");
    createCommitment({
      kind: "expense",
      name: "Аренда",
      amountMinor: 400000,
      activeFrom: "2026-08",
    });

    expect(listCommitments()).toHaveLength(2);
  });

  it("updates an amount in place", () => {
    const rent = createCommitment({
      kind: "expense",
      name: "Аренда",
      amountMinor: 400000,
      activeFrom: "2026-01",
    });

    expect(updateCommitment(rent.id, { amountMinor: 450000 }).amountMinor).toBe(450000);
  });

  it("reports a missing row rather than failing silently", () => {
    expect(() => updateCommitment(9999, { amountMinor: 100 })).toThrow(/not found/);
  });
});
