import { describe, expect, it } from "bun:test";
import { parseAmountToMinor, formatMinor } from "../src/money";

describe("parseAmountToMinor", () => {
  it("parses a dot decimal", () => {
    expect(parseAmountToMinor("184.20")).toBe(18420);
  });

  it("parses a comma decimal, as printed on Polish receipts", () => {
    expect(parseAmountToMinor("184,20")).toBe(18420);
  });

  it("parses a whole number without decimals", () => {
    expect(parseAmountToMinor("184")).toBe(18400);
  });

  it("parses a single decimal place", () => {
    expect(parseAmountToMinor("184.2")).toBe(18420);
  });

  it("accepts a JavaScript number", () => {
    expect(parseAmountToMinor(184.2)).toBe(18420);
  });

  it("does not lose a grosz to floating point", () => {
    // 184.20 * 100 === 18419.999999999996 in IEEE 754
    expect(parseAmountToMinor(184.2)).toBe(18420);
    expect(parseAmountToMinor("1.15")).toBe(115);
    expect(parseAmountToMinor("2.675")).toBe(268);
  });

  it("handles thousands separators", () => {
    expect(parseAmountToMinor("1 234,56")).toBe(123456);
    expect(parseAmountToMinor("1234.56")).toBe(123456);
  });

  it("handles negative amounts", () => {
    expect(parseAmountToMinor("-184,20")).toBe(-18420);
  });

  it("rejects a non-numeric string", () => {
    expect(() => parseAmountToMinor("abc")).toThrow();
  });

  it("rejects an empty string", () => {
    expect(() => parseAmountToMinor("")).toThrow();
  });
});

describe("formatMinor", () => {
  it("formats with two decimal places", () => {
    expect(formatMinor(18420)).toBe("184.20");
  });

  it("pads a single-digit remainder", () => {
    expect(formatMinor(18405)).toBe("184.05");
  });

  it("formats zero", () => {
    expect(formatMinor(0)).toBe("0.00");
  });

  it("formats a negative amount", () => {
    expect(formatMinor(-18420)).toBe("-184.20");
  });

  it("round-trips with parseAmountToMinor", () => {
    expect(parseAmountToMinor(formatMinor(18420))).toBe(18420);
  });
});
