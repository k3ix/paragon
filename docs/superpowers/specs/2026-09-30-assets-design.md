# Paragon assets: what is held, next to what is spent

Date: 2026-09-30
Status: draft

## The problem this solves

The application tracks flow and knows nothing about stock. It can say that 21 470 was
moved to savings in September; it cannot say what is in the savings account.

This surfaced on 2026-09-30. Two dental payments had been recorded, each paired with a
transfer out of savings, and the balance was reasoned about as "16 840 minus the
withdrawals". The owner corrected it: the account holds **107 123.29**. The figure the
conversation had been using was the delta since August, when recording began — not a
balance at all.

The owner's words: *"в этом проблема и то о чем мы думали, расширять приложение и
трекать активы и сбережения"*.

Money also exists outside that account — a brokerage portfolio at XTB, cash that
predates the application, and bonds under consideration. None of it is visible
anywhere.

## Established facts

From the owner, over the design conversation. These shape every decision below.

- **The purpose is threefold**: see the total in one place, see what each holding
  earns, and record anything with its details. Splitting the total into an emergency
  fund, an apartment fund and next month's rent was explicitly rejected — *"это скорее
  вынужденно а не то чтобы я прям хотел"*.
- **No goal tracking.** A "progress toward the apartment" figure was considered and
  dropped: the denominator would have to be invented, and inventing it is worse than
  not showing it.
- **Transactions drive balances; the portfolio is revalued by hand.** The owner already
  records every movement and finds it easy here — *"намного легче делать тут с ии чем в
  допотопных приложках"*. Share prices move on their own, so a portfolio figure is
  typed in, not derived.
- **Two kinds of thing, one screen.** Accounts hold money; holdings are money invested.
  They answer different questions and are stored separately, but the owner sees them
  together: *"рядом они должны быть, все таки это все мои активы"*.
- **Everyday cards are out of scope.** Deliberately. A card balance would diverge from
  reality within a day, and a reconciliation warning that is always on is a
  reconciliation warning nobody reads. *"я не хотел привязываться копейка к копейке"*.
- **Interest is income; revaluation is not.** Interest and coupons are money that
  arrived and can be spent. A portfolio worth more this month than last is worth more
  on paper only. The owner: *"денег нет физически, просто поменялась цена актива"*.
- **Past transfers will be assigned to accounts retroactively.** There are roughly a
  dozen, all large, all identifiable — savings, brokerage, or cash.

## What is stored

### `accounts` — where money sits

| Column | Notes |
|---|---|
| `id` | |
| `name` | "PKO Konto Oszczędnościowe Plus" |
| `currency` | Default PLN. Present so foreign-currency holdings do not need a second table. |
| `balance_minor` | Current balance, in minor units like every other amount in the schema. |
| `opening_minor` | Balance on the day the account entered the application. Reconciliation counts movements from here; without it there is nothing to count from. |
| `opened_on` | "YYYY-MM-DD". Transfers before this date belong to the opening figure, not to the movements. |
| `rate_bp` | Annual rate in basis points, nullable. 4.25% is 425. Basis points keep it an integer. |
| `promo_until` | "YYYY-MM-DD", nullable. When a promotional rate expires. |
| `archived_at` | Nullable. Closed accounts stop appearing without losing their history. |

Cash is an account with no rate. A foreign-currency account carries its own currency
and is converted for the total at a rate the owner supplies.

### `holdings` — what money is invested in

| Column | Notes |
|---|---|
| `id` | |
| `name` | "XTB", "Obligacje DOR" |
| `kind` | `equity` or `bond`. |
| `invested_minor` | Sum of what was put in. Moved by transfers, not typed. |
| `value_minor` | What it is worth now. Typed in by the owner. |
| `valued_at` | When `value_minor` was last set. |
| `rate_bp` | Bonds only, nullable. |
| `matures_on` | Bonds only, nullable. |
| `archived_at` | |

**Lots are deliberately absent.** The owner noted that XTB keeps every purchase as a
separate lot and that the history could be reconstructed. It could — but the question
this screen answers is "what did it grow by", and `invested` against `value` answers
it. Lots earn their place when a specific sale has to be taxed, and that is not on the
horizon. Adding them later does not invalidate anything here.

### Changes to `transactions`

Four nullable columns:

- `from_account_id` / `to_account_id` — the account money left and arrived in
- `from_holding_id` / `to_holding_id` — the same for a holding

All four are usually null: a purchase at Żabka names nothing, because cards are not
tracked. They are set on transfers between the owner's own places, and on income that
lands somewhere tracked.

Four columns where two would do is clumsy, and the alternatives were weighed: a
polymorphic `(kind, id)` pair loses the foreign keys, and letting both tables share one
id space invites them to merge back into a single table with half its columns empty.
Separate typed columns keep the constraints and stay readable in a query.

An invariant belongs in `invariants.ts`: a transaction may name at most one source and
one destination, and may never name both an account and a holding on the same side.

## How money moves

| Event | What happens |
|---|---|
| Purchase | Nothing new. No account named. |
| Salary | `income`, `starts_period: true`. No account: it lands on cards. |
| Card to savings | `transfer`, `to_account_id` = savings. Balance rises. |
| Savings to card | `transfer`, `from_account_id` = savings. Balance falls. |
| Card to brokerage | `transfer`, `to_holding_id` = XTB. `invested_minor` rises. |
| Interest on savings | `income`, `to_account_id` = savings, `starts_period: false`. Balance rises. |
| Bond coupon | `income`, `to_account_id` = the account it lands in, `starts_period: false`. |
| Revaluation | Not a transaction. `value_minor` and `valued_at` are updated. |

`starts_period: false` on interest matters. The flag exists because income that merely
surfaced now must not split the month in two; a monthly interest credit would do
exactly that, reporting the salary as if it had never arrived.

Interest on the savings account is income that is already saved — it arrives and stays
where it is. A bond coupon lands in a spendable account and is distributed with the
next salary. Both are income; their paths differ, and the account fields record which.

## Reconciliation

A balance typed in by hand and a balance implied by transactions will drift. The drift
is the useful part: it means a movement was not recorded.

For each account: `opening_minor` plus every movement recorded since `opened_on`
(transfers in and out, income credited) should equal `balance_minor`. A mismatch shows
one line — the size of the difference, and that something is missing. When the numbers
agree, nothing is shown.

The owner chose to assign accounts to past transfers rather than start from a clean
slate, so `opened_on` for the savings account is set to the first day the application
has data for (2026-07-31) and `opening_minor` to the balance on that day — today's
107 123.29 less everything recorded since. Reconciliation then covers the whole
recorded history, and if it does not come out clean, a transfer really is missing.

This works here precisely because it cannot work for cards. Savings movements are few,
large, and already recorded; a discrepancy is a real signal rather than noise.

## The screen

A new page, **Активы**.

At the top, the total: accounts plus holdings, converted to PLN.

**Счета** — one row each: name, balance, rate. Subtotal.

**Вложения** — one row each: name, invested, current value, the difference in money and
percent. Subtotal, and when the valuation was last updated.

Three warnings, each silent unless it applies:

- a balance that does not reconcile
- a promotional rate expiring within a month
- a valuation older than a month

The period screen is unchanged. It is about flow; this page is about stock. A single
line in the footer of the main screen gives the total and links here.

## Entry

Through MCP, like everything else: "процент на сберег 380 за сентябрь", "портфель XTB
сейчас 5 900". New tools mirror the existing ones — `list_accounts`, `set_balance`,
`revalue_holding` — and `add_transactions` gains optional account and holding fields.

A settings page allows editing by hand, for corrections that do not deserve a sentence
in chat.

## What this does not include

- **Goals and progress.** Removed during design; the denominator would be invented.
- **Purpose-tagging of balances.** The owner does not want the total split.
- **Everyday cards.** Out of scope by decision, not by omission.
- **Purchase lots.** Deferred until a sale needs to be taxed.
- **Automatic price feeds.** The portfolio figure is typed in. A feed is a dependency,
  a failure mode and a rate limit in exchange for saving one sentence a month.

## Getting the existing data in

One schema migration, then a conversation.

**The migration** creates both tables and the four transaction columns. Nothing else is
automated.

**The conversation** is how the data arrives, because every judgement in it is the
owner's:

1. Enter what exists today: savings 107 123.29, the XTB portfolio, cash, any bonds.
2. Walk the existing transfers one at a time — roughly a dozen rows — and decide for
   each whether it went to savings, to the brokerage, or came out of cash. No rule can
   infer this; the owner remembers it.
3. Derive `opening_minor` per account by subtracting those movements from today's
   balance, and set `opened_on` to 2026-07-31.

Reconciliation comes out clean by construction after step 3. Its value starts with the
next movement recorded after this.
