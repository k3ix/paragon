import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { sqlite } from "../db";

const DEFAULT_DIR = join(import.meta.dir, "..", "..", "backups");
const FILENAME = /^paragon-\d{8}-\d{6}\.db$/;

/** "paragon-20260809-143052.db" — sortable, and readable at a glance. */
function timestampName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `paragon-${date}-${time}.db`;
}

/**
 * Writes a consistent snapshot of the database.
 *
 * VACUUM INTO rather than copying the file: the database runs in WAL mode, so recent
 * writes live in paragon.db-wal until a checkpoint. A copy of paragon.db alone opens
 * without complaint and is silently missing the newest rows — a backup that looks fine
 * until the day it is needed.
 */
export function createBackup(directory: string = DEFAULT_DIR): {
  path: string;
  sizeBytes: number;
} {
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });

  const path = join(directory, timestampName(new Date()));
  sqlite.exec("VACUUM INTO ?", [path] as never);

  return { path, sizeBytes: statSync(path).size };
}

export function listBackups(
  directory: string = DEFAULT_DIR,
): { path: string; takenAt: number; sizeBytes: number }[] {
  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter((name) => FILENAME.test(name))
    .map((name) => {
      const path = join(directory, name);
      const stat = statSync(path);
      return { path, takenAt: stat.mtimeMs / 1000, sizeBytes: stat.size };
    })
    .sort((a, b) => b.takenAt - a.takenAt);
}

/** Deletes all but the newest `keep` backups. */
export function pruneBackups(keep: number, directory: string = DEFAULT_DIR): { removed: number } {
  if (keep < 1) throw new Error("Backup retention must keep at least one file.");

  const stale = listBackups(directory).slice(keep);
  for (const backup of stale) rmSync(backup.path, { force: true });

  return { removed: stale.length };
}
