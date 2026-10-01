import { describe, expect, test } from "bun:test";
import { day } from "../src/lib/format";

describe("day", () => {
  // Eden parses date-shaped strings into Date objects on the way in, and React cannot
  // render a Date: it throws "Objects are not valid as a React child" and unmounts the
  // whole tree. That is what a black screen on the assets page was.
  test("renders a Date the client coerced back as a plain day", () => {
    expect(day(new Date(2026, 4, 7))).toBe("2026-05-07");
  });

  test("leaves a string alone", () => {
    expect(day("2026-05-07")).toBe("2026-05-07");
  });

  test("renders nothing for a missing day rather than the word null", () => {
    expect(day(null)).toBe("");
    expect(day(undefined)).toBe("");
  });

  test("uses local parts, so a Date built from a local day keeps that day", () => {
    // A UTC-based formatter would name the previous day for any evening Date in Kraków.
    expect(day(new Date(2026, 11, 10, 23, 30))).toBe("2026-12-10");
  });
});
