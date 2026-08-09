import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import * as schema from "./schema";

// Tests point DB_PATH at a scratch file. Never let a test touch the real data.
const dbPath = process.env.DB_PATH ?? "paragon.db";

const sqlite = new Database(dbPath);
// ponytail: Database.exec is flagged deprecated in Bun 1.3 types but is still the
// documented way to issue PRAGMAs; switch to the replacement once one is published.
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

export const db = drizzle({ client: sqlite, schema });
export { sqlite };
