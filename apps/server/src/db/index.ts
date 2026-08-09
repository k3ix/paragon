import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import * as schema from "./schema";

// Anchored to this file, not the working directory: the MCP server is launched by
// Claude from wherever it happens to be, and a relative path would silently create
// an empty database there instead of opening the real one.
// Tests point DB_PATH at a scratch file. Never let a test touch the real data.
const dbPath = process.env.DB_PATH ?? join(import.meta.dir, "..", "..", "paragon.db");

const sqlite = new Database(dbPath);
// ponytail: Database.exec is flagged deprecated in Bun 1.3 types but is still the
// documented way to issue PRAGMAs; switch to the replacement once one is published.
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

export const db = drizzle({ client: sqlite, schema });
export { sqlite };
