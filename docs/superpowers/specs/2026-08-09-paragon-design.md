# Paragon — household expense tracker

Date: 2026-08-09
Status: design approved, ready for implementation planning

## Problem

Expense tracking for a two-person household. Spending in PLN, income in EUR. The primary
input path is a receipt photo or a bank push notification screenshot sent to a Claude chat:
Claude reads the image, calls an MCP tool, and the server writes structured rows. Reviewing
happens in a web dashboard.

The owner's goal, in their own words: convenient to record, convenient to keep an eye on.

### Why not an off-the-shelf app

1. **Category management.** In Spendee, Wallet and YNAB the taxonomy belongs to someone else.
   Even where categories can be edited, history is not recalculated retroactively. Two months
   in you realize "Home" needs splitting into "Household" and "Renovation" — and all previous
   statistics become worthless.
2. **Splitting one receipt across categories.** A single Biedronka purchase is groceries,
   cleaning supplies and alcohol as three separate lines.
3. **Shared budget.** Income and spending are spread across two cards; it has to be clear who
   paid and whether the expense was shared.

Additionally, the PKO statement is sparse — often just `Płatność kartą` with no meaningful
merchant — so detail has to be filled in from receipts.

### What the research showed

YNAB, Monarch, Copilot, Actual Budget, Lunch Money and Firefly III were reviewed, along with
Hacker News discussions about why people abandon trackers. Three findings shaped this design:

- **The main reason people quit is not laziness — it is the absence of conclusions.** The
  typical story: someone logged every expense for four months and "nothing stood out." The log
  existed; the insight did not. Hence the requirement that the dashboard answer "is everything
  normal" rather than present a twenty-row table.
- **Category pie charts produce no conclusions** — but they stay in v1 as a way to drill into
  the category tree, not as the headline metric.
- **Losing history is the third most common reason people quit.** Backups are in v1.

## Key decisions

### Chat-first input, not forms

This shapes the entire design. The server never receives images and performs no recognition —
OCR and initial categorization are Claude's job. The server accepts finished JSON. As a
result, the following drop out of scope:

| Not built | Replaced by |
|---|---|
| CSV file upload in the frontend | The statement goes into the chat; Claude parses it and calls the same write tool |
| Merchant rules screen (`pattern → category`) | A merchants table acting as memory for Claude |
| Bulk selection via checkboxes | "Move every Rossmann from the last three months into cleaning supplies" — as a sentence |
| Drag-and-drop category tree | "Move Renovation out of Household up a level" — as a sentence |

The frontend covers viewing and single-row edits: clicking a row changes its amount, category
or date. Bulk and structural operations go through the chat.

### Merchants as memory, not rules

A `pattern → category` rule exists to serve an importer that decides on its own. Here Claude
decides, and what it needs is not a regex but a fact: "Żabka has appeared 47 times, it is
groceries." Hence a `merchants` table with `default_category_id`, populated automatically on
write. A side benefit is ready-made analytics: average basket and visit frequency.

### MCP transport: stdio now, HTTP later

The first version runs locally over stdio, the way Huntly does. No public hosting until it is
clear the tool actually gets used.

This imposes an architectural constraint: **MCP tools call a shared service layer rather than
touching the database directly.** Huntly's tools go straight to Drizzle; that is not viable
here for two reasons. First, deduplication and the line-sum invariant are needed by both the
chat and the frontend — with direct access that logic gets written twice and drifts apart.
Second, moving to a remote transport must be a transport swap, not a rewrite of every tool.

## Stack

Based on Huntly — the same owner's project, which already runs an MCP server.

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | Bun | As in Huntly; `bun:sqlite` and `bun:test` are built in |
| HTTP | Elysia | Enables Eden Treaty: the frontend imports the server type and gets a typed client with no codegen |
| Database | SQLite (`bun:sqlite`), WAL | A couple thousand transactions a year; backup is a file copy |
| ORM | Drizzle | As in Huntly |
| MCP | `@modelcontextprotocol/sdk`, stdio | The `{def, handler}` tool pattern carries over from Huntly |
| Frontend | React 19 + Vite + Tailwind v4 + shadcn/ui | Huntly's theme already defines `--chart-1..5` |
| Data fetching | TanStack Query | The `queries.ts` pattern carries over |
| Charts | Recharts | Huntly has no charts — added from scratch |
| Tables | TanStack Table | Huntly hand-rolls `.filter().sort()`, which will not hold for hundreds of rows |
| Validation | Zod, schemas in `packages/shared` | As in Huntly |

Express was rejected: Eden Treaty provides end-to-end typing for free. The alternative is
codegen via orval, as in the same owner's `flat-building-budget-tracker` — two manual scripts
and a `swagger.json` committed to the repo. The Huntly approach is simpler.

### What is deliberately not carried over from Huntly

| Huntly practice | Decision here | Reason |
|---|---|---|
| Dates as `text` via `datetime('now')` | Integer timestamp | Period filters and monthly grouping |
| Whole-unit money | Minor units as integers | `184,20 PLN` does not fit whole złoty; floats are unacceptable for money |
| No migrations, only `db:push` | Versioned migrations | The spending history is worth keeping |
| `.db` file committed | Added to `.gitignore` | — |
| `postinstall` symlink workaround | Configure workspaces properly | — |
| MCP tools query the database directly | Tools call the service layer | See the transport section |

### Repository layout

```
apps/server     Elysia + MCP + Drizzle
apps/web        React + Vite
packages/shared Zod schemas and types
```

## Data model

Some fields are not used by any v1 screen but are included from the start: recovering them
later would mean manually reviewing the entire history.

```
categories
  id, parent_id, name, is_fixed, archived_at

merchants
  id, name_norm, default_category_id, seen_count, last_seen_at

transactions
  id, occurred_on, type, total_minor, currency, fx_rate,
  merchant_raw, merchant_id, payer, scope, account,
  note, dedup_hash, created_at

line_items
  id, transaction_id, amount_minor, category_id, is_fixed_override, note
```

### Field rationale

**`type`: `expense | income | transfer`.** Without a distinct `transfer` type, moving money to
savings lands in expenses and withdrawing lands in income, making the savings rate
meaningless. Transfers are excluded from both totals.

**`is_fixed` on the category, `is_fixed_override` on the line.** Rent is always fixed, but a
one-off large purchase filed under "Home" is not. The flag on the category alone loses
precision; on the line alone it demands manual tagging of every expense. The category supplies
the default, the line overrides it when needed.

**`currency` + `fx_rate` on the transaction.** Income in EUR, spending in PLN, plus travel.
The rate is pinned to the transaction date and never changes afterwards. Storing only a
converted amount would rewrite the entire history every time the rate moves.

**Money as integers in minor units (grosze).** Never floats.

**`merchant_raw` alongside `merchant_id`.** The raw statement description is kept verbatim,
with the normalized merchant as a reference. The raw value cannot be reconstructed later.

**`parent_id` with unlimited depth.** A tree of any depth, at the owner's explicit request —
rigid categories were their primary reason for rejecting off-the-shelf apps.

### Invariants

- `sum(line_items.amount_minor) = transactions.total_minor`. No receipt means one line for the
  full amount; a receipt means several lines. Enforced in the service layer on every write.
- `dedup_hash = hash(occurred_on, total_minor, merchant_norm)`, unique index. A repeat
  submission returns `already_exists` instead of creating a second row. The same receipt will
  be submitted twice — first as a photo, later inside a statement — this is guaranteed.
- A category with history is archived (`archived_at`), never deleted: it disappears from
  pickers but remains in past reports.
- All write operations are idempotent.

### Privacy

Not stored: IBANs, card numbers, full names. Date, amount and merchant are sufficient.

## MCP tools

Reads:

```
list_categories()                    category tree
get_merchant(name)                   default category, counter, last seen
search_transactions(filter)          by merchant, period, amount, category
get_summary(period, group_by)        totals and delta against the previous period
```

Writes:

```
add_transactions(items[])            batch; each item carries line_items[]
update_transaction(id, fields)
delete_transaction(id)
create_category(name, parent?)
update_category(id, {name, parent, archived, is_fixed})
reassign_line_items(filter, to_category)
```

### `reassign_line_items` is the core

One filtered tool covers three scenarios:

- **merge**: move from A to B, then archive A;
- **split**: several calls with different filters;
- **bulk recategorization**: that is exactly what it is.

There are no separate `merge_categories` or `split_category` tools.

Without this tool Claude would have to pull four hundred rows into context and issue four
hundred edits. With it, one server-side `UPDATE`.

This tool implements the project's headline feature: recalculating history when the taxonomy
changes.

## Screens

The v1/later split follows data availability, not importance. Plan-versus-actual is physically
impossible in month one — there is no history to average. A pie chart works from the first
transaction.

### First version

- **Savings rate** — the share of income left over this month, plus twelve months of history.
  The dashboard's headline number.
- **Monthly totals** — income, spending, difference.
- **Category pie chart** with drill-down into the subtree and then into the expense list.
- **Income versus spending over time** — line chart.
- **Transaction list** with period, category and type filters, plus search.
- **Click-to-edit** — amount, category, date, note; deletion; expanding a receipt into lines.
- **Category tree** — viewing and renaming.
- **Merchant list** — frequency, average basket, default category.
- **Manual entry form** — minimal, for when the chat is not open.
- **Export** to CSV and JSON.
- **Backup** — a daily copy of the database file, retained thirty days.

### Later versions

- **Plan versus actual**, where the plan is derived automatically as a three-month average.
  Borrowed from Actual Budget's `#template average 3 months` — the owner does not want to fill
  in budgets by hand across twenty categories. Requires three months of history.
- **Fixed versus discretionary split** — uses `is_fixed`, answers "how much do I actually need
  per month."
- **Anomaly feed** — two or three lines on what deviated from normal: "Groceries +42% against
  average", "Żabka — 47 purchases". An empty feed means everything is steady, which is also an
  answer.
- **Matching receipts to statement entries** by amount and date ±2 days. A heuristic requiring
  confirmation. Built only if practice shows it is needed.

## Order of work

1. **Skeleton and end-to-end run.** Monorepo, migrations, service layer, `list_categories` and
   `add_transactions`, MCP over stdio. Deduplication and the line-sum invariant belong here —
   they are write invariants and cannot arrive after the first write. Done when a receipt photo
   becomes rows in the database and a repeat submission returns `already_exists`.
2. **Merchants.** Table, `get_merchant`, automatic population on write.
3. **Frontend: viewing.** Dashboard, transaction list, pie chart, monthly trend.
4. **Frontend: editing.** Click-to-edit, receipt lines, category tree, merchant list.
5. **Recategorization.** `reassign_line_items` and the remaining category tools. The project's
   headline feature.
6. **Summaries and reports.** `get_summary`, export, backup.

Beyond that, driven by actual use: plan versus actual, fixed/discretionary split, anomaly feed.

## Out of scope

- Bank synchronization — no PSD2 access, only CSV and receipts.
- A native mobile app — the Claude app is the phone entry point.
- Public hosting and remote MCP — deferred until the tool proves itself in use. The
  architecture is ready: the transport changes, the tools do not.
- Double-entry bookkeeping — single-entry with an explicit `transfer` type is sufficient for
  personal finance. Double-entry is among the leading reasons such systems get abandoned.
- Net worth tracking, machine learning for anomaly detection, automatic subscription
  detection.

## Open questions

- **The `payer` and `scope` fields.** Present in the schema, since a shared budget is one of
  the three reasons for building this. But one person records for both, and no v1 screen uses
  them. They get populated on entry; their use will be decided later.
- **Display currency.** Income in EUR, spending in PLN. v1 shows PLN with income converted at
  the transaction-date rate. Whether a toggle is needed will become clear from real data.
