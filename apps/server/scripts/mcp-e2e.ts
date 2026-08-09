/**
 * End-to-end check of the MCP server over stdio, speaking real JSON-RPC.
 * Runs against a scratch database so the working data is untouched.
 */
import { spawn } from "node:child_process";
import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
// Static: schema.ts reads no environment, so it can be imported before DB_PATH is set.
// A computed await import() would erase its types and make every row `any`.
import { transactions, lineItems } from "../src/db/schema";

// Anchored so the script runs from anywhere.
const SERVER_ROOT = join(import.meta.dir, "..");

const DB = "/tmp/paragon-mcp-e2e.db";
for (const s of ["", "-wal", "-shm"]) if (existsSync(DB + s)) unlinkSync(DB + s);

// Seed categories into the scratch database before the server opens it.
process.env.DB_PATH = DB;
const { migrate } = await import("drizzle-orm/bun-sqlite/migrator");
// The import must stay dynamic so DB_PATH is set first, but the type can be taken
// statically — `typeof import()` is erased at runtime and loads nothing.
const { db }: { db: typeof import("../src/db").db } = await import(join(SERVER_ROOT, "src/db"));
migrate(db, { migrationsFolder: join(SERVER_ROOT, "drizzle") });
const { createCategory } = await import(join(SERVER_ROOT, "src/services/categories"));
const food = createCategory({ name: "Food" });
createCategory({ name: "Groceries", parentId: food.id });
const home = createCategory({ name: "Home" });
createCategory({ name: "Cleaning", parentId: home.id });
createCategory({ name: "Rent", parentId: home.id, isFixed: true });

const child = spawn("bun", ["run", "src/mcp/index.ts"], {
  cwd: SERVER_ROOT,
  env: { ...process.env, DB_PATH: DB },
  stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
const pending = new Map<number, (msg: any) => void>();

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let index: number;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)!(msg);
      pending.delete(msg.id);
    }
  }
});
child.stderr.on("data", (c) => console.error("[stderr]", c.toString().trim()));

let nextId = 1;
function send(method: string, params?: unknown): Promise<any> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => reject(new Error(`timeout on ${method}`)), 10000);
  });
}

function text(res: any): string {
  return res.result?.content?.[0]?.text ?? JSON.stringify(res.error ?? res);
}

const init = await send("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "e2e", version: "0" },
});
console.log("1. initialize ->", init.result.serverInfo.name, init.result.serverInfo.version);
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

const tools = await send("tools/list");
console.log("2. tools/list ->", tools.result.tools.map((t: any) => t.name).join(", "));

const cats = await send("tools/call", { name: "list_categories", arguments: {} });
console.log("3. list_categories ->\n" + text(cats).split("\n").map((l) => "     " + l).join("\n"));

const receipt = {
  items: [
    {
      date: "2026-08-09",
      total: "184.20",
      merchant: "Biedronka",
      lineItems: [
        { amount: "124.30", category: "Food/Groceries" },
        { amount: "38.00", category: "Home/Cleaning" },
        { amount: "21.90", category: "Food/Groceries", note: "wine" },
      ],
    },
  ],
};

const add = await send("tools/call", { name: "add_transactions", arguments: receipt });
console.log("4. add_transactions (split receipt) ->", text(add).replace(/\n+/g, " | "));

const again = await send("tools/call", { name: "add_transactions", arguments: receipt });
console.log("5. same receipt again ->", text(again).replace(/\n+/g, " | "));

const noBreakdown = await send("tools/call", {
  name: "add_transactions",
  arguments: { items: [{ date: "2026-08-10", total: "23.50", merchant: "Żabka" }] },
});
console.log("6. push notification, no breakdown ->", text(noBreakdown).replace(/\n+/g, " | "));

// Step 6 teaches nothing (no category), so file one categorized purchase for the
// memory to remember.
const categorized = await send("tools/call", {
  name: "add_transactions",
  arguments: {
    items: [
      {
        date: "2026-08-12",
        total: "19.90",
        merchant: "Żabka",
        lineItems: [{ amount: "19.90", category: "Food/Groceries" }],
      },
    ],
  },
});
console.log("7. categorized Żabka purchase ->", text(categorized).replace(/\n+/g, " | "));

const bad = await send("tools/call", {
  name: "add_transactions",
  arguments: {
    items: [
      {
        date: "2026-08-11",
        total: "100.00",
        merchant: "Test",
        lineItems: [{ amount: "60.00", category: "Food/Groceries" }],
      },
    ],
  },
});
console.log("8. lines that do not add up ->", text(bad).replace(/\n+/g, " | "));

const known = await send("tools/call", {
  name: "get_merchant",
  arguments: { name: "Żabka" },
});
console.log("9. get_merchant after one filing ->", text(known).replace(/\n+/g, " | "));

const unknown = await send("tools/call", {
  name: "get_merchant",
  arguments: { name: "Lidl" },
});
console.log("10. get_merchant for a new shop ->", text(unknown).replace(/\n+/g, " | "));

const bankSpelling = await send("tools/call", {
  name: "get_merchant",
  arguments: { name: "ZABKA" },
});
console.log("11. same shop, bank spelling ->", text(bankSpelling).replace(/\n+/g, " | "));

const pin = await send("tools/call", {
  name: "set_merchant_category",
  arguments: { name: "Żabka", category: "Home/Cleaning" },
});
console.log("12. pin to another category ->", text(pin).replace(/\n+/g, " | "));

const afterPin = await send("tools/call", {
  name: "get_merchant",
  arguments: { name: "Żabka" },
});
console.log("13. lookup after pinning ->", text(afterPin).replace(/\n+/g, " | "));

const txs = db.select().from(transactions).all();
const lines = db.select().from(lineItems).all();
console.log(`\n14. database: ${txs.length} transactions, ${lines.length} line items`);
for (const t of txs) {
  const mine = lines.filter((l) => l.transactionId === t.id);
  const sum = mine.reduce((a, l) => a + l.amountMinor, 0);
  console.log(
    `   #${t.id} ${t.merchantRaw ?? "(none)"} total=${t.totalMinor} lines=${mine.length} sum=${sum} ${sum === t.totalMinor ? "OK" : "MISMATCH"}`,
  );
}

child.kill();
for (const s of ["", "-wal", "-shm"]) if (existsSync(DB + s)) unlinkSync(DB + s);
