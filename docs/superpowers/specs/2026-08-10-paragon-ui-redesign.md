# Paragon UI redesign: from "savings rate" to "how much to set aside"

Date: 2026-08-10
Status: approved

## The problem this solves

The owner states it plainly: *"I don't know how much I need for a month, so I think I
should set money aside at the end — and at the end there is never much left, always
with an excuse."*

He wants to move the setting-aside to payday. To do that he needs one number: **how
much can leave the account the day salary arrives without the month running short.**

The current dashboard cannot answer that. It is built around a savings rate, which
needs an income figure that is usually zero in the database, so the loudest element on
the page reads:

```
Kept this month
—
−1 073.70 of 0.00 PLN
```

Everything below it has the same problem in smaller type.

## Established facts

These come from the owner and shape every decision below.

- **One salary, two cards.** Both cards draw on the same money. There is no split by
  person and none is wanted. `account` stays a bookkeeping field for reconciling
  against a bank statement, not something the screen shows.
- **Everything is in PLN.** Salary is paid in zloty (roughly 14 000 to each card,
  ~28 000 base). Month-to-month variation is a couple of hundred zloty. No currency
  conversion is needed; `fxRate` stays unused.
- **Income above base is unpredictable** — overtime and on-call. The base is what
  arrives every month regardless.
- **Fixed costs exist but are not recorded yet** — rent and utilities run through the
  wife's card. They will be entered.
- **History is nine days deep.** Twenty-seven transactions, one month, no salary rows.
- **Two people read this screen.** The interface must be in Russian.

## The core calculation

```
set aside = base income − committed − typical living costs
```

- **base income** — the recurring salary, entered once, not the actual amount that
  landed. Anything above base (overtime, on-call) is surplus and is set aside whole.
- **committed** — costs that repeat every month at a known amount: rent, utilities,
  subscriptions. Known in advance, not discovered from a statement.
- **typical living costs** — the average of completed months for everything else.

Computing from base rather than actual is the point. Actual income varies with
overtime, so a formula anchored to it yields a different answer every month — and a
good month teaches spending habits that a weak month cannot pay for. Anchored to base,
the payday number is stable and surplus accumulates instead of dissolving.

### Why an average of three months

One month is too noisy — a single large grocery run distorts it. Three months of
completed history is the minimum before an average means anything.

**The current month is never included.** It is partial, and averaging a partial month
against complete ones biases the result downward.

### Behaviour before there is enough history

With fewer than three completed months the average does not exist. The screen says so
rather than inventing a figure:

```
Отложить в этом месяце

        —
  Соберу за 2 месяца. Пока записано 9 дней.

  Обязательное   9 400   ✓ известно
  На жизнь         ...   нужно ещё 2 месяца
```

Committed costs appear as soon as they are entered, because they are declared rather
than derived. Only the living-cost average waits for history.

## Screen layout

One working screen. Category management moves to settings — it is visited rarely and
currently masquerades as half the application.

### 1. How much to set aside

The answer to the owner's question, and the only loud element on the page.

Filled-in example — the amounts are illustrative, since rent is not yet recorded and
no month of history is complete:

```
Отложить в этом месяце

        6 200 zł
        из 28 000 базы

  Обязательное   9 400     каждый месяц одно и то же
  На жизнь      12 400     среднее за 3 месяца
  ─────────────────────
  Остаётся       6 200
```

The three-line breakdown is not decoration: it shows which lever moves the number.
Committed costs are changed by renegotiating; living costs are changed by daily
choices.

### 2. How much is spent so far

```
Потрачено в августе

  1 073 zł          119 zł в день · осталось 22 дня
  ████████░░░░░░░░░░░░░░░░░░░░░░░  из 12 400 на жизнь
```

Without a living-cost budget there is no bar — only the total and the daily rate. The
bar appears once the average exists.

### 3. Where the money went

A tree, replacing the donut chart. The donut showed four top-level slices and hid the
subcategory split the owner explicitly asked for (alcohol separate from snacks).

```
Еда                    802.79   75%  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
  Продукты             431.68   40%  ▓▓▓▓▓▓▓▓
  Рестораны            245.21   23%  ▓▓▓▓
  Алкоголь              67.82    6%  ▓
  Вкусняшки             43.15    4%  ▓
Дом                    128.56   12%  ▓▓
  Хозтовары             98.56    9%  ▓
  Коммуналка            30.00    3%  ▓
Подписки                92.99    9%  ▓▓
Транспорт               49.36    5%  ▓
Подарки                 24.50    2%
```

Expanded by default — fifteen categories is not enough to justify hiding any. Clicking
a row filters the purchase list below to that category.

Once history exists, each row gains a comparison against the previous month
(`+340 к июлю`). That delta is the raw material for optimisation: it names what grew.

### 4. Purchases

The existing list, with three fixes:

- **Grouped by day**, with a per-day subtotal.
- **Split receipts show their lines.** Currently `Action` renders as `Хозтовары +1`,
  hiding exactly the breakdown that was carefully entered.
- **Filterable** by clicking a category in the tree above.

### Removed

- **The income/spending line chart.** Income arrives once a month, so the line is flat
  then vertical — it carries no information. A monthly spending bar chart replaces it
  later, once there are months to compare.
- **The savings rate percentage.** Replaced by an amount. A percentage is abstract; an
  amount is an instruction.

### Language

The entire interface is Russian. It is currently half English (`PURCHASES`,
`KEPT THIS MONTH`, `flexible`) while the data is Russian, and two people read it.

## Backend work

### Recurring commitments (new)

Rent is known before it is paid, so it cannot be derived from transaction history. A
new table holds declared monthly amounts:

| column | type | note |
|---|---|---|
| `id` | integer | |
| `name` | text | "Аренда" |
| `amount_minor` | integer | |
| `category_id` | integer | links to the category tree |
| `active_from` | text | `YYYY-MM`, the month this amount took effect |
| `active_to` | text, nullable | `YYYY-MM` inclusive; null while current |

These are month strings rather than the Unix seconds used elsewhere, because a
commitment applies to a whole month. Storing an instant would force every read to
decide which month a timestamp falls in — the same rollover trap that once turned
`2026-13` into January 2027.

`active_from` / `active_to` exist because rent changes. Without them, raising the rent
would silently rewrite every past month's calculation.

Requires a migration.

### Base income (new)

The base is declared, not derived — actual salary rows vary with overtime, and the
whole point is to anchor the calculation to what arrives every month regardless.

Stored the same way as a commitment: an amount with `active_from` / `active_to`, so a
raise does not retroactively rewrite past months. One row, edited when pay changes.

### Typical living costs

Average spending across completed months, excluding:

- the current month (partial)
- categories covered by a recurring commitment (already counted as committed)

Returns null when fewer than three completed months exist, along with how many are
still needed — the screen renders that directly.

### Month-over-month category comparison

Per category: this month's total, previous month's total, the delta. Reuses the
existing breakdown query with a second month.

## Testing

- **The calculation** — set-aside arithmetic, average with 0/1/2/3+ months of history,
  commitments starting and ending mid-history.
- **Boundaries** — no income recorded, no commitments, a month with no transactions.
- **Screens** — the tree renders nesting correctly; the empty state appears when
  history is short; clicking a category filters the list.

Screenshots at 1280px and 390px, because the last round of UI defects (wrapping
amounts, unlabelled currency, charts stealing keyboard focus) were all invisible to
curl and obvious in an image.

## Deliberately not built

- **Splitting by card or person.** One salary, shared money — the split answers a
  question nobody is asking.
- **Currency conversion.** Everything is already in PLN.
- **Plan-versus-actual per category.** Requires the living-cost average to exist first.
  Revisit after three months of history.
