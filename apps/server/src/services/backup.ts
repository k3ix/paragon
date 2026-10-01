import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { sqlite } from "../db";

const DEFAULT_DIR = join(import.meta.dir, "..", "..", "backups");
// The optional "-2" suffix disambiguates two backups taken in the same second.
const FILENAME = /^paragon-\d{8}-\d{6}(-\d+)?\.db$/;

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

  // Names carry one-second resolution and VACUUM INTO refuses an existing file, so two
  // backups in the same second would throw. A suffix is cheaper than widening the
  // timestamp, which would change every existing filename and the pattern that finds
  // them.
  let path = join(directory, timestampName(new Date()));
  for (let n = 2; existsSync(path); n++) {
    path = join(directory, timestampName(new Date()).replace(/\.db$/, `-${n}.db`));
  }
  sqlite.exec("VACUUM INTO ?", [path] as never);

  return { path, sizeBytes: statSync(path).size };
}

/**
 * When the snapshot's data is from, read from its name rather than its mtime.
 *
 * The filename is the only durable record of that. A cp, rsync, restore or editor
 * touching the directory rewrites every mtime — as happened here on 2026-09-28, giving
 * nineteen files named across two months one identical timestamp. Trusting mtime would
 * make the oldest snapshot look newest, so the staleness check would skip the backup it
 * exists to take, and pruning would delete the newest file instead of the oldest.
 */
function takenAtFromName(name: string): number {
  const m = /^paragon-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(name);
  // Unreachable: callers filter on FILENAME first, which is a stricter form of this.
  if (!m) throw new Error(`Not a backup filename: ${name}`);
  const [, year, month, day, hour, minute, second] = m;
  return (
    new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ).getTime() / 1000
  );
}

export function listBackups(
  directory: string = DEFAULT_DIR,
): { path: string; takenAt: number; sizeBytes: number }[] {
  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter((name) => FILENAME.test(name))
    .map((name) => {
      const path = join(directory, name);
      return { path, takenAt: takenAtFromName(name), sizeBytes: statSync(path).size };
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

/** How many backups to keep when one is taken automatically. */
const AUTO_RETENTION = 30;

/**
 * Takes a backup only if the newest one is older than `maxAgeHours`.
 *
 * Backups used to be taken by hand. That worked while the code was being written and
 * stopped the moment it wasn't: on 2026-09-30 the newest copy turned out to be seven
 * weeks and two hundred transactions old. A backup that depends on someone remembering
 * is not a backup, so the write path takes one itself.
 *
 * Returns the path when a copy was made, or null when a recent one already existed.
 */
export function backupIfStale(
  maxAgeHours: number,
  directory: string = DEFAULT_DIR,
): string | null {
  const newest = listBackups(directory)[0];
  if (newest) {
    const ageHours = (Date.now() / 1000 - newest.takenAt) / 3600;
    if (ageHours < maxAgeHours) return null;
  }

  const { path } = createBackup(directory);
  pruneBackups(AUTO_RETENTION, directory);
  return path;
}
