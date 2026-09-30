import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync, utimesSync } from "node:fs";
import { Database } from "bun:sqlite";
import { resetTestDb } from "./helpers/db";
import { createCategory } from "../src/services/categories";
import { addTransactions } from "../src/services/transactions";
import { createBackup, listBackups, pruneBackups, backupIfStale } from "../src/services/backup";

const DIR = "/tmp/paragon-backup-test";

beforeEach(() => {
  resetTestDb();
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
});

afterEach(() => {
  rmSync(DIR, { recursive: true, force: true });
});

function seed() {
  const food = createCategory({ name: "Food" });
  createCategory({ name: "Groceries", parentId: food.id });
  addTransactions([
    {
      date: "2026-08-09",
      total: "184.20",
      merchant: "Biedronka",
      lineItems: [{ amount: "184.20", category: "Food/Groceries" }],
    },
  ]);
}

describe("createBackup", () => {
  it("writes a file", () => {
    seed();
    const result = createBackup(DIR);
    expect(existsSync(result.path)).toBe(true);
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  it("produces a database that actually opens and holds the data", () => {
    seed();
    const { path } = createBackup(DIR);

    // The point of VACUUM INTO over a file copy: WAL contents are included.
    const restored = new Database(path, { readonly: true });
    const rows = restored.query("SELECT total_minor FROM transactions").all() as {
      total_minor: number;
    }[];
    restored.close();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.total_minor).toBe(18420);
  });

  it("includes writes made moments earlier", () => {
    seed();
    // A plain copy of the .db file would miss this, since it is still in the WAL.
    addTransactions([
      {
        date: "2026-08-10",
        total: "23.50",
        merchant: "Żabka",
        lineItems: [{ amount: "23.50", category: "Food/Groceries" }],
      },
    ]);

    const { path } = createBackup(DIR);
    const restored = new Database(path, { readonly: true });
    const count = restored.query("SELECT count(*) as n FROM transactions").get() as { n: number };
    restored.close();

    expect(count.n).toBe(2);
  });

  it("names the file with a sortable timestamp", () => {
    seed();
    const { path } = createBackup(DIR);
    expect(path).toMatch(/paragon-\d{8}-\d{6}\.db$/);
  });
});

describe("listBackups", () => {
  it("returns an empty list for a directory with none", () => {
    expect(listBackups(DIR)).toEqual([]);
  });

  it("lists what was written, newest first", async () => {
    seed();
    createBackup(DIR);
    // The filename carries whole seconds, so two in the same second would collide.
    await Bun.sleep(1100);
    createBackup(DIR);

    const backups = listBackups(DIR);
    expect(backups).toHaveLength(2);
    expect(backups[0]!.takenAt).toBeGreaterThanOrEqual(backups[1]!.takenAt);
  });

  it("ignores unrelated files", async () => {
    seed();
    createBackup(DIR);
    await Bun.write(`${DIR}/notes.txt`, "not a backup");

    expect(listBackups(DIR)).toHaveLength(1);
  });
});

describe("pruneBackups", () => {
  it("keeps the newest and removes the rest", async () => {
    seed();
    createBackup(DIR);
    await Bun.sleep(1100);
    createBackup(DIR);
    await Bun.sleep(1100);
    createBackup(DIR);

    const result = pruneBackups(2, DIR);
    expect(result.removed).toBe(1);
    expect(listBackups(DIR)).toHaveLength(2);
  });

  it("removes nothing when there are fewer than the limit", () => {
    seed();
    createBackup(DIR);

    expect(pruneBackups(30, DIR).removed).toBe(0);
    expect(listBackups(DIR)).toHaveLength(1);
  });

  it("refuses to keep zero", () => {
    // Pruning to nothing is never intended and would delete every backup.
    expect(() => pruneBackups(0, DIR)).toThrow(/keep/i);
  });
});

describe("backupIfStale", () => {
  it("skips a backup when a recent one already exists", () => {
    const first = backupIfStale(24, DIR);
    expect(first).not.toBeNull();
    const second = backupIfStale(24, DIR);
    expect(second).toBeNull();
    expect(listBackups(DIR)).toHaveLength(1);
  });

  it("writes one when the newest copy is old enough", () => {
    const first = backupIfStale(24, DIR);
    expect(first).not.toBeNull();

    // Age the existing copy by a day. Backup names carry one-second resolution, so
    // without moving it back in time a second copy would land on the same filename.
    const dayAgo = new Date(Date.now() - 25 * 3600 * 1000);
    utimesSync(first as string, dayAgo, dayAgo);

    expect(backupIfStale(24, DIR)).not.toBeNull();
    expect(listBackups(DIR)).toHaveLength(2);
  });

  it("writes the first one when nothing exists yet", () => {
    expect(listBackups(DIR)).toHaveLength(0);
    expect(backupIfStale(24, DIR)).not.toBeNull();
  });
});

describe("automatic backup on write", () => {
  it("does not write into the real backup directory from a test run", () => {
    // DB_PATH is set by test/helpers/db, which is what marks this as not-live.
    expect(process.env.DB_PATH).toBeTruthy();

    const before = listBackups().length;
    seed();
    expect(listBackups()).toHaveLength(before);
  });
});
