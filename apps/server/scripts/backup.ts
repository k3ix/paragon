import { createBackup, pruneBackups, listBackups } from "../src/services/backup";

const result = createBackup();
const pruned = pruneBackups(30);

console.log(
  `Backup written: ${result.path} (${Math.round(result.sizeBytes / 1024)} KB). ` +
    `${listBackups().length} kept, ${pruned.removed} removed.`,
);
