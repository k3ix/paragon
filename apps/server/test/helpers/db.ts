import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

// Anchor both paths to this file so the suite behaves the same whether it is run
// from the repository root or from apps/server.
const SERVER_ROOT = join(import.meta.dir, "..", "..");
const MIGRATIONS = join(SERVER_ROOT, "drizzle");

// Must be set before any import of src/db, which reads it at module load.
const TEST_DB = join(SERVER_ROOT, "paragon.test.db");
process.env.DB_PATH = TEST_DB;

for (const suffix of ["", "-wal", "-shm"]) {
  const file = `${TEST_DB}${suffix}`;
  if (existsSync(file)) unlinkSync(file);
}

const { migrate } = await import("drizzle-orm/bun-sqlite/migrator");
const { db, sqlite } = await import("../../src/db");
const schema = await import("../../src/db/schema");

migrate(db, { migrationsFolder: MIGRATIONS });

/** Clears every table. Call in beforeEach. */
export function resetTestDb() {
  // categories.parent_id references categories with ON DELETE RESTRICT, so a single
  // DELETE trips the constraint when a parent happens to be removed before its child.
  // Suspending enforcement for the wipe is simpler than ordering deletes by depth.
  sqlite.exec("PRAGMA foreign_keys = OFF;");
  db.delete(schema.lineItems).run();
  db.delete(schema.transactions).run();
  db.delete(schema.merchants).run();
  db.delete(schema.categories).run();
  sqlite.exec("PRAGMA foreign_keys = ON;");
}

export { db, schema };
