import { unlinkSync, existsSync } from "node:fs";

// Must be set before any import of src/db, which reads it at module load.
const TEST_DB = "paragon.test.db";
process.env.DB_PATH = TEST_DB;

for (const suffix of ["", "-wal", "-shm"]) {
  const file = `${TEST_DB}${suffix}`;
  if (existsSync(file)) unlinkSync(file);
}

const { migrate } = await import("drizzle-orm/bun-sqlite/migrator");
const { db } = await import("../../src/db");
const schema = await import("../../src/db/schema");

migrate(db, { migrationsFolder: "./drizzle" });

/** Clears every table. Call in beforeEach. */
export function resetTestDb() {
  db.delete(schema.lineItems).run();
  db.delete(schema.transactions).run();
  db.delete(schema.merchants).run();
  db.delete(schema.categories).run();
}

export { db, schema };
