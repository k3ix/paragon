# Paragon

Household expense and asset tracker, built for one household and used daily.

The input path is a photo: a receipt or a bank notification goes to a Claude chat, Claude reads
it and calls an MCP tool, and the server writes structured rows. A web dashboard answers "is
everything normal this month" before it shows any table.

## What it does

- Expenses split across a category tree you own; restructure categories and history follows.
- Shared budget: who paid, whether it was shared, income in one currency and spending in another.
- Assets: accounts, holdings and purchase lots, a movement ledger for every transfer, valuation
  history, and reconciliation against real balances.
- Automatic backups on write, at most once a day.
- An MCP server so the whole thing is operable from Claude Code and Claude chat.

## Stack

Bun, Elysia, Drizzle, SQLite on the server; React, Vite, Tailwind and TanStack Query on the web;
Eden Treaty for end-to-end types; `@modelcontextprotocol/sdk` for the MCP server.

## Run

```
bun install
bun run --cwd apps/server db:migrate
bun run --cwd apps/server dev
bun run --cwd apps/web dev
```

Design notes and implementation plans live in `docs/superpowers/`.
