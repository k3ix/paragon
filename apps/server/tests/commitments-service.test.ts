import { test, expect, afterEach } from "bun:test";
import { db } from "../src/db";
import { commitments } from "../src/db/schema";
import {
  createCommitment,
  listCommitments,
  endCommitment,
  commitmentsForMonth,
} from "../src/services/commitments";

afterEach(() => {
  db.delete(commitments).run();
});

test("a commitment applies from its start month onward", () => {
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

test("ending a commitment stops it after the given month", () => {
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

test("a raise is two rows, so past months keep the old amount", () => {
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

test("an invalid month is refused", () => {
  expect(() =>
    createCommitment({
      kind: "expense",
      name: "Аренда",
      amountMinor: 400000,
      activeFrom: "2026-13",
    }),
  ).toThrow(/Invalid month/);
});

test("a commitment ending before it starts is refused", () => {
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

test("listing returns every row regardless of validity", () => {
  const a = createCommitment({
    kind: "income",
    name: "Зарплата",
    amountMinor: 2800000,
    activeFrom: "2026-01",
  });
  endCommitment(a.id, "2026-03");
  createCommitment({
    kind: "expense",
    name: "Аренда",
    amountMinor: 400000,
    activeFrom: "2026-08",
  });

  expect(listCommitments()).toHaveLength(2);
});
