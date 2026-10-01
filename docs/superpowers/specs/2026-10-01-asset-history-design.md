# Asset history: where a balance came from, and how a portfolio got here

Date: 2026-10-01
Status: draft

## The problem this solves

The assets screen shipped on 2026-09-30 and answers one question: what is held today.
107 123.29 in savings, 14 857.95 at XTB, 121 981.24 altogether.

The owner's verdict after a day of looking at it: *"как то мало на активах я хз, мало
инфы, хочется на них нажать будто"*.

The figures have no provenance. The savings balance does not say which paycheques built
it; the portfolio says it grew by 479.41 without saying over what period or from which
purchases. Every transfer already carries the account or holding it moved — that was
done the same day — and nothing reads those columns back.

A second gap is narrower but worse: `holdings.valued_at` keeps only the newest
valuation. Each revaluation overwrites the last, so the portfolio's history is erased as
it accumulates.

## Established facts

From the owner, over the design conversation.

- **Lots are for analysis, not for the screen.** He can already see them in XTB's own
  app. The reason to hold them here is so they can be *reasoned about* — *"чтобы у тебя
  был доступ и в каком то формате я мог с ии это анализировать а не на скринах,
  особенно когда лотов станет я хз сколько"*. Five lots fit in a screenshot; forty do
  not.
- **Lots are never revalued.** A lot records what was true at purchase and stays put.
  Revaluation happens once, at the portfolio level, from one figure the owner reads off
  XTB.
- **Entry is per purchase, as it happens.** *"купил - закинул все заполнилось"*. No CSV
  import, no broker integration.
- **`invested` is computed from transfers, not from lots.** The owner was explicit, and
  right: he sends round numbers, and the broker's figure is what survived currency
  conversion and commission. Transfers total 14 380.00; the lots total 14 378.54. The
  1.46 difference is the broker's cut, and *what he invested is 14 380*.
- **The May transfer is missing and must be added**: 3 000.00 on 2026-05-07, from his
  card. Bookkeeping began in August, so the purchase exists at XTB with no transfer
  behind it.
- **Transfers and lots are not paired.** They disagree by construction: money sits at
  the broker before it buys anything, and the rate moves in between. August shows it —
  6 750.00 transferred, 6 807.66 bought. They are two true statements about different
  events, and nothing should force them into one.
- **Broker costs are not worth surfacing.** 1.46 over five months. *"да забей"*.

## What is stored

### `lots` — individual purchases

| Column | Notes |
|---|---|
| `id` | |
| `holding_id` | References `holdings`, ON DELETE cascade. A lot without its holding is meaningless. |
| `bought_on` | "YYYY-MM-DD". |
| `quantity_micro` | Units × 1 000 000, as an integer. 4.3823 units is `4382300`. Fractional shares are normal here, and floats are not allowed near money. |
| `price_minor` | Price per unit in the instrument's currency, minor units. 157.92 EUR is `15792`. |
| `currency` | The instrument's currency, e.g. "EUR". Separate from PLN deliberately. |
| `fx_rate` | Rate to PLN at purchase, in millionths — the convention `transactions.fxRate` already uses. 4.2482 is `4248200`. |
| `cost_minor` | What the purchase cost in PLN, as the broker reported it. Named `cost`, not `value`: `holdings.value_minor` means what something is worth today, and a lot's figure never changes. Stored rather than derived — for the five known lots quantity × price × rate reproduces it to the grosz, but that holds only while the broker reports a clean rate and takes no per-trade fee, and a figure that is sometimes derived and sometimes not is worse than one that is always recorded. |
| `note` | |

Six decimals rather than three: XTB reports four (4.3823), so three would round and lose
a digit the broker actually gave us. The extra precision costs nothing — SQLite integers
are 64-bit and a portfolio of thousands of units is nowhere near the limit.

### `valuations` — what a holding was worth, over time

| Column | Notes |
|---|---|
| `id` | |
| `holding_id` | References `holdings`, ON DELETE cascade. |
| `valued_on` | "YYYY-MM-DD". |
| `value_minor` | PLN. |

One row per revaluation. `holdings.value_minor` and `valued_at` stay as they are — they
hold the newest figure and every existing reader keeps working. The new table is the
history behind them, written at the same moment.

A second valuation on a day that already has one replaces it. Revaluing twice in an
afternoon is correcting a typo, not recording a new fact.

### Changes to `holdings`

`invested_minor` stops being written by `createHolding` and is maintained solely by
transfers, which `addTransactions` already does. The field stays; its source narrows.

For the existing XTB row this means a correction: it currently holds 14 378.54 (the
broker's figure, typed in at creation) and must become 14 380.00 once the May transfer
is recorded — 2 750 + 4 000 + 4 630 + 3 000.

## What the screen shows

Each account and holding becomes expandable. Collapsed, the page looks as it does now.

**An account expands to its movements**: date, amount, note, running balance. For the
savings account that is five rows telling the story the headline figure cannot — 4 000
and 10 000 in August, 4 000 and 12 840 in September, 1 000 back out for the dentist.

**A holding expands to three things**:

1. *Movements* — transfers in and out, same as an account.
2. *Purchases* — the lots: date, quantity, price, rate, cost in PLN. Growth per lot is
   not shown. It would need a current price per lot, which is exactly the per-lot
   revaluation the owner ruled out.
3. *Valuations* — a sparkline of value over time, with the current figure. Below three
   data points it renders as a list; a two-point chart is a decoration.

The running balance in the movements list is computed from `opening_minor` forward, so
it reconciles with what the account says — and when it does not, the existing warning
already says so.

## Entry

`record_asset` gains two actions:

- `add_lot` — `holdingId`, `boughtOn`, `quantity`, `price`, `currency`, `fxRate`,
  `valuePln`. One call per purchase.
- it already has `revalue`, which now also appends to `valuations`.

A purchase is two statements, and both get recorded: a transfer (money left the card)
through `add_transactions`, and a lot (shares were bought) through `record_asset`. They
are not the same event and the dates genuinely differ.

## Backfill

Five lots exist at XTB and are known from screenshots the owner sent on 2026-09-30:

| Bought | Quantity | Price EUR | Rate | PLN |
|---|---|---|---|---|
| 2026-05-07 | 4.3823 | 157.92 | 4.2482 | 2 939.98 |
| 2026-08-10 | 9.1674 | 168.42 | 4.3227 | 6 674.13 |
| 2026-08-10 | 0.1834 | 168.44 | 4.3226 | 133.53 |
| 2026-09-10 | 6.2933 | 166.16 | 4.3417 | 4 540.09 |
| 2026-09-10 | 0.1259 | 166.14 | 4.3416 | 90.81 |

Total 14 378.54.

The May transfer of 3 000.00 is recorded as a transfer dated 2026-05-07 into the XTB
holding, from his card, noted as entered retrospectively. It predates every pay period
in the database, which is harmless: transfers do not open periods, and the period
machinery keys on income.

One valuation is seeded from the existing row: 14 857.95 on 2026-09-30.

`holdings.invested_minor` for XTB currently reads 14 378.54, typed in at creation from
the broker's figure. Recording the May transfer moves it to 17 378.54 — wrong twice
over. It must be set to 14 380.00 as part of the backfill: 2 750 + 4 000 + 4 630 + 3 000,
which is what the four transfers now total.

## What this does not include

- **Per-lot current value.** Ruled out: it needs a price per lot at every revaluation.
- **Tax lot accounting (FIFO, realised gains).** The holding is an IKE, which is not
  taxed on gains if held to retirement. If a taxable brokerage account appears later,
  this is where it would go.
- **Broker cost reporting.** 1.46 over five months.
- **CSV import from XTB.** Rejected in favour of per-purchase entry.
- **Sales.** Nothing has been sold. A sale would need to reduce quantity across lots,
  which is the FIFO question above.
