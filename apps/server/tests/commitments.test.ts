import { test, expect } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { commitments } from "../src/db/schema";

test("a commitment round-trips through the table", () => {
  const inserted = db
    .insert(commitments)
    .values({
      kind: "expense",
      name: "Аренда",
      amountMinor: 400000,
      activeFrom: "2026-08",
    })
    .returning()
    .get();

  expect(inserted.amountMinor).toBe(400000);
  expect(inserted.activeTo).toBeNull();

  db.delete(commitments).where(eq(commitments.id, inserted.id)).run();
});
