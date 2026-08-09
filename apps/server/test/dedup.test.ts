import { describe, expect, it } from "bun:test";
import { normalizeMerchant, computeDedupHash } from "../src/services/dedup";

describe("normalizeMerchant", () => {
  it("lowercases", () => {
    expect(normalizeMerchant("BIEDRONKA")).toBe("biedronka");
  });

  it("strips Polish diacritics so bank and receipt spellings agree", () => {
    expect(normalizeMerchant("Żabka")).toBe("zabka");
    expect(normalizeMerchant("ŻABKA")).toBe("zabka");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeMerchant("Lidl   sp.  z o.o.")).toBe("lidl sp z oo");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeMerchant("  Orlen  ")).toBe("orlen");
  });

  it("drops punctuation", () => {
    expect(normalizeMerchant("Sp. z o.o.")).toBe("sp z oo");
  });

  it("removes terminal reference numbers a bank appends", () => {
    expect(normalizeMerchant("ZABKA NANO Z1234")).toBe("zabka nano");
  });

  it("removes a reference code followed by a city, as PKO writes it", () => {
    // The statement reads "ZABKA NANO Z1234 WARSZAWA" while the receipt says "Żabka".
    // If the code survives, the two spellings hash differently and the duplicate slips through.
    expect(normalizeMerchant("ZABKA NANO Z1234 WARSZAWA")).toBe("zabka nano warszawa");
  });

  it("removes a bare numeric reference mid-string", () => {
    expect(normalizeMerchant("BIEDRONKA 4491 KRAKOW")).toBe("biedronka krakow");
  });

  it("keeps digits that are part of the name", () => {
    expect(normalizeMerchant("Circle K 24")).toBe("circle k 24");
  });

  it("keeps a short number that is part of the name", () => {
    expect(normalizeMerchant("Sklep 24h")).toBe("sklep 24h");
  });

  it("returns an empty string for empty input", () => {
    expect(normalizeMerchant("")).toBe("");
    expect(normalizeMerchant("   ")).toBe("");
  });
});

describe("computeDedupHash", () => {
  const base = { occurredOn: 1786230000, totalMinor: 18420, merchantNorm: "biedronka" };

  it("is stable across calls", () => {
    expect(computeDedupHash(base)).toBe(computeDedupHash(base));
  });

  it("changes when the amount changes", () => {
    expect(computeDedupHash(base)).not.toBe(computeDedupHash({ ...base, totalMinor: 18421 }));
  });

  it("changes when the date changes", () => {
    expect(computeDedupHash(base)).not.toBe(computeDedupHash({ ...base, occurredOn: 1786316400 }));
  });

  it("changes when the merchant changes", () => {
    expect(computeDedupHash(base)).not.toBe(computeDedupHash({ ...base, merchantNorm: "zabka" }));
  });

  it("returns a hex digest", () => {
    expect(computeDedupHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});
