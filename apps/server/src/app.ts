import { Elysia, t } from "elysia";
import {
  listCategories,
  createCategory,
  updateCategory,
  archiveCategory,
} from "./services/categories";
import {
  getMonthSummary,
  getMonthlyTrend,
  getCategoryBreakdown,
  getCategoryTreeBreakdown,
  getCategoryTreeForRange,
} from "./services/summary";
import {
  assetsSummary,
  createAccount,
  updateAccount,
  createHolding,
  revalueHolding,
} from "./services/assets";
import { reconcileAccounts } from "./services/reconcile";
import { getBudget } from "./services/budget";
import { getPace } from "./services/pace";
import { payPeriods, resolvePeriod } from "./services/periods";
import { getPeriodSummary } from "./services/period-summary";
import {
  listCommitments,
  createCommitment,
  updateCommitment,
  endCommitment,
} from "./services/commitments";
import { listTransactions } from "./services/queries";
import { updateTransaction, deleteTransaction } from "./services/transactions";
import { listMerchants } from "./services/merchants";
import { reassignLineItems, previewReassign } from "./services/reassign";
import { getSummary } from "./services/report";
import { exportCsv, exportJson } from "./services/export";
import { createBackup, pruneBackups } from "./services/backup";

// Matches the shape "YYYY-MM". The month *number* is still validated in the service,
// because 2026-13 matches this pattern but is not a month.
const monthPattern = "^\\d{4}-\\d{2}$";
const dayPattern = "^\\d{4}-\\d{2}-\\d{2}$";
const monthQuery = t.Object({ month: t.String({ pattern: monthPattern }) });

// A period is either a calendar month or a pay period keyed by its start date.
const periodPattern = "^(\\d{4}-\\d{2}|pay-\\d{4}-\\d{2}-\\d{2})$";

export const app = new Elysia({ prefix: "/api" })
  /*
   * A bad month reaches the services as a thrown Error, which would otherwise surface
   * as a 500 — reading as "the server is broken" rather than "that is not a month".
   *
   * The status is set without returning a body: returning one here would widen every
   * route's response type with the error shape, forcing the browser to narrow a union
   * before touching any field. Elysia still serialises the thrown error.
   */
  .onError(({ code, error, set }) => {
    if (code === "VALIDATION") {
      set.status = 422;
      return;
    }
    const message = error instanceof Error ? error.message : String(error);

    // "not found" is the caller naming a row that is gone; everything else the services
    // throw is the caller sending something invalid. A 500 here would read as "the
    // server is broken" when the request simply cannot be honoured.
    if (/not found/i.test(message)) {
      set.status = 404;
      return;
    }
    if (
      /^Invalid month/i.test(message) ||
      /does not match/i.test(message) ||
      /Unknown category path/i.test(message) ||
      /already exists/i.test(message) ||
      /cycle/i.test(message) ||
      /requires line items/i.test(message) ||
      /needs at least one filter/i.test(message) ||
      /must be positive/i.test(message) ||
      /before it starts/i.test(message)
    ) {
      set.status = 422;
    }
  })

  .get("/categories", () => listCategories())

  .get("/summary", ({ query }) => getMonthSummary(query.month), { query: monthQuery })

  .get("/trend", ({ query }) => getMonthlyTrend(query.month, query.count ?? 12), {
    query: t.Object({
      month: t.String({ pattern: monthPattern }),
      count: t.Optional(t.Number({ minimum: 1, maximum: 60 })),
    }),
  })

  .get("/breakdown", ({ query }) => getCategoryBreakdown(query.month), { query: monthQuery })

  .get("/budget", ({ query }) => getBudget(query.month), { query: monthQuery })

  .get("/pace", ({ query }) => getPace(query.month), { query: monthQuery })

  // Accepts a period id so the tree covers the same window as the figures above it —
  // otherwise the page shows "spent 0" beside a tree full of the previous paycheque.
  .get(
    "/tree",
    ({ query }) => {
      if (query.period) {
        const { start, end } = resolvePeriod(query.period);
        // Compare against the whole previous pay period rather than a window of equal
        // length: an open period is only as long as the days elapsed so far, and
        // measuring it against the same few days a month ago says nothing.
        const all = payPeriods();
        const index = all.findIndex((p) => p.start === start);
        const before = index >= 0 ? all[index + 1] : undefined;
        // With no earlier period on record there is nothing to compare against, and
        // an equal-length window ending at the period start would compare a few days
        // of one paycheque against a few days of another. An empty window yields no
        // deltas at all, which is the honest answer.
        return getCategoryTreeForRange(start, end, before ?? { start, end: start });
      }
      return getCategoryTreeBreakdown(query.month!);
    },
    {
      query: t.Object({
        month: t.Optional(t.String({ pattern: monthPattern })),
        period: t.Optional(t.String({ pattern: periodPattern })),
      }),
    },
  )

  // Pay periods available to switch between, newest first. Empty until a salary is
  // recorded, which is what the UI uses to decide whether to offer the toggle.
  //
  // The response is typed explicitly because `id` looks like an ISO date, and without
  // a schema Elysia coerces it to a Date on the way out — the browser then receives an
  // object where it expects a string.
  .get("/periods", () => payPeriods(), {
    response: t.Array(
      t.Object({
        kind: t.String(),
        id: t.String(),
        label: t.String(),
        start: t.Number(),
        end: t.Number(),
        open: t.Boolean(),
        expectedDays: t.Number(),
      }),
    ),
  })

  // Accepts either a month ("2026-08") or a pay period start ("2026-08-10").
  .get("/period-summary", ({ query }) => getPeriodSummary(query.period), {
    query: t.Object({ period: t.String({ pattern: periodPattern }) }),
    // `period.id` needs the same protection from date coercion as /periods above.
    response: t.Object({
      period: t.Object({
        kind: t.String(),
        id: t.String(),
        label: t.String(),
        start: t.Number(),
        end: t.Number(),
        open: t.Boolean(),
        expectedDays: t.Number(),
      }),
      incomeMinor: t.Number(),
      savedMinor: t.Number(),
      spentMinor: t.Number(),
      leftMinor: t.Number(),
      committedMinor: t.Number(),
      occasionalMinor: t.Number(),
      livingMinor: t.Number(),
      committedParts: t.Array(t.Object({ label: t.String(), amountMinor: t.Number() })),
      occasionalParts: t.Array(t.Object({ label: t.String(), amountMinor: t.Number() })),
      livingParts: t.Array(t.Object({ label: t.String(), amountMinor: t.Number() })),
      daysElapsed: t.Number(),
      daysTotal: t.Number(),
      daysRemaining: t.Number(),
      perDayMinor: t.Union([t.Number(), t.Null()]),
      perDayLeftMinor: t.Union([t.Number(), t.Null()]),
    }),
  })

  // Stock, not flow: what is held, as against what moved. The reconciliation gaps ride
  // along because they are only meaningful next to the balances they contradict.
  // The response is declared rather than inferred: without it Eden hands the frontend
  // `{}` and every field access there is unchecked.
  .get("/assets", () => ({ ...assetsSummary(), reconciliation: reconcileAccounts() }), {
    response: t.Object({
      totalMinor: t.Number(),
      accountsTotalMinor: t.Number(),
      holdingsInvestedMinor: t.Number(),
      holdingsValueMinor: t.Number(),
      accounts: t.Array(
        t.Object({
          id: t.Number(),
          name: t.String(),
          currency: t.String(),
          balanceMinor: t.Number(),
          openingMinor: t.Number(),
          openedOn: t.Union([t.String(), t.Null()]),
          rateBp: t.Union([t.Number(), t.Null()]),
          promoUntil: t.Union([t.String(), t.Null()]),
        }),
      ),
      holdings: t.Array(
        t.Object({
          id: t.Number(),
          name: t.String(),
          kind: t.String(),
          investedMinor: t.Number(),
          valueMinor: t.Union([t.Number(), t.Null()]),
          valuedAt: t.Union([t.String(), t.Null()]),
          rateBp: t.Union([t.Number(), t.Null()]),
          maturesOn: t.Union([t.String(), t.Null()]),
          growthMinor: t.Union([t.Number(), t.Null()]),
          growthPercent: t.Union([t.Number(), t.Null()]),
        }),
      ),
      staleValuations: t.Array(
        t.Object({
          id: t.Number(),
          name: t.String(),
          valuedAt: t.Union([t.String(), t.Null()]),
        }),
      ),
      expiringPromos: t.Array(
        t.Object({ id: t.Number(), name: t.String(), promoUntil: t.String() }),
      ),
      reconciliation: t.Array(
        t.Object({
          accountId: t.Number(),
          name: t.String(),
          expectedMinor: t.Number(),
          statedMinor: t.Number(),
          differenceMinor: t.Number(),
        }),
      ),
    }),
  })

  .post("/accounts", ({ body }) => createAccount(body), {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      balanceMinor: t.Integer(),
      openingMinor: t.Integer(),
      currency: t.Optional(t.String({ minLength: 3, maxLength: 3 })),
      openedOn: t.Optional(t.Union([t.String({ pattern: dayPattern }), t.Null()])),
      rateBp: t.Optional(t.Union([t.Integer(), t.Null()])),
      promoUntil: t.Optional(t.Union([t.String({ pattern: dayPattern }), t.Null()])),
    }),
  })

  .patch("/accounts/:id", ({ params, body }) => updateAccount(Number(params.id), body), {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      name: t.Optional(t.String({ minLength: 1 })),
      balanceMinor: t.Optional(t.Integer()),
      openingMinor: t.Optional(t.Integer()),
      openedOn: t.Optional(t.Union([t.String({ pattern: dayPattern }), t.Null()])),
      rateBp: t.Optional(t.Union([t.Integer(), t.Null()])),
      promoUntil: t.Optional(t.Union([t.String({ pattern: dayPattern }), t.Null()])),
      archived: t.Optional(t.Boolean()),
    }),
  })

  .post("/holdings", ({ body }) => createHolding(body), {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      kind: t.Union([t.Literal("equity"), t.Literal("bond")]),
      investedMinor: t.Integer(),
      rateBp: t.Optional(t.Union([t.Integer(), t.Null()])),
      maturesOn: t.Optional(t.Union([t.String({ pattern: dayPattern }), t.Null()])),
    }),
  })

  .patch(
    "/holdings/:id/value",
    ({ params, body }) => revalueHolding(Number(params.id), body.valueMinor, body.valuedAt),
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        valueMinor: t.Integer(),
        valuedAt: t.String({ pattern: dayPattern }),
      }),
    },
  )

  .get("/commitments", () => listCommitments())

  .post("/commitments", ({ body }) => createCommitment(body), {
    body: t.Object({
      kind: t.Union([t.Literal("income"), t.Literal("expense")]),
      name: t.String({ minLength: 1 }),
      amountMinor: t.Number(),
      categoryId: t.Optional(t.Union([t.Number(), t.Null()])),
      activeFrom: t.String({ pattern: monthPattern }),
      activeTo: t.Optional(t.Union([t.String({ pattern: monthPattern }), t.Null()])),
    }),
  })

  .patch("/commitments/:id", ({ params, body }) => updateCommitment(Number(params.id), body), {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      kind: t.Optional(t.Union([t.Literal("income"), t.Literal("expense")])),
      name: t.Optional(t.String({ minLength: 1 })),
      amountMinor: t.Optional(t.Number()),
      categoryId: t.Optional(t.Union([t.Number(), t.Null()])),
      activeFrom: t.Optional(t.String({ pattern: monthPattern })),
      activeTo: t.Optional(t.Union([t.String({ pattern: monthPattern }), t.Null()])),
    }),
  })

  // DELETE ends a commitment rather than removing it: past months must keep the
  // amount that actually applied to them. The month defaults to the current one so
  // the button in the UI needs no argument.
  .delete(
    "/commitments/:id",
    ({ params, query }) => {
      const now = new Date();
      const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
      return endCommitment(Number(params.id), query.month ?? thisMonth);
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Object({ month: t.Optional(t.String({ pattern: monthPattern })) }),
    },
  )

  .get(
    "/transactions",
    ({ query }) =>
      listTransactions({
        month: query.month,
        period: query.period,
        type: query.type,
        limit: query.limit,
        offset: query.offset,
      }),
    {
      query: t.Object({
        month: t.Optional(t.String({ pattern: monthPattern })),
        period: t.Optional(t.String({ pattern: periodPattern })),
        type: t.Optional(t.String()),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 500 })),
        offset: t.Optional(t.Number({ minimum: 0 })),
      }),
    },
  )

  .get("/merchants", () => listMerchants())

  .get("/report", ({ query }) => getSummary(query.month), { query: monthQuery })

  .get(
    "/export.csv",
    ({ query, set }) => {
      set.headers["content-type"] = "text/csv; charset=utf-8";
      set.headers["content-disposition"] =
        `attachment; filename="paragon-${query.month ?? "all"}.csv"`;
      return exportCsv({ month: query.month });
    },
    { query: t.Object({ month: t.Optional(t.String({ pattern: monthPattern })) }) },
  )

  .get(
    "/export.json",
    ({ query, set }) => {
      set.headers["content-type"] = "application/json; charset=utf-8";
      set.headers["content-disposition"] =
        `attachment; filename="paragon-${query.month ?? "all"}.json"`;
      return exportJson({ month: query.month });
    },
    { query: t.Object({ month: t.Optional(t.String({ pattern: monthPattern })) }) },
  )

  .patch("/transactions/:id", ({ params, body }) => updateTransaction(Number(params.id), body), {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      date: t.Optional(t.String()),
      total: t.Optional(t.Union([t.String(), t.Number()])),
      type: t.Optional(
        t.Union([t.Literal("expense"), t.Literal("income"), t.Literal("transfer")]),
      ),
      merchant: t.Optional(t.Union([t.String(), t.Null()])),
      note: t.Optional(t.Union([t.String(), t.Null()])),
      lineItems: t.Optional(
        t.Array(
          t.Object({
            amount: t.Union([t.String(), t.Number()]),
            category: t.Optional(t.String()),
            name: t.Optional(t.String()),
            note: t.Optional(t.String()),
          }),
        ),
      ),
    }),
  })

  .delete("/transactions/:id", ({ params }) => deleteTransaction(Number(params.id)), {
    params: t.Object({ id: t.String() }),
  })

  .post("/categories", ({ body }) => createCategory(body), {
    body: t.Object({
      name: t.String({ minLength: 1 }),
      parentId: t.Optional(t.Union([t.Number(), t.Null()])),
      isFixed: t.Optional(t.Boolean()),
      isOccasional: t.Optional(t.Boolean()),
    }),
  })

  .patch("/categories/:id", ({ params, body }) => updateCategory(Number(params.id), body), {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      name: t.Optional(t.String({ minLength: 1 })),
      parentId: t.Optional(t.Union([t.Number(), t.Null()])),
      isFixed: t.Optional(t.Boolean()),
      isOccasional: t.Optional(t.Boolean()),
    }),
  })

  .delete("/categories/:id", ({ params }) => archiveCategory(Number(params.id)), {
    params: t.Object({ id: t.String() }),
  })

  .post("/backup", () => {
    const result = createBackup();
    // Thirty days of daily snapshots, matching the spec's retention.
    const pruned = pruneBackups(30);
    return { ...result, removed: pruned.removed };
  })

  .post(
    "/reassign",
    ({ body }) => {
      const { toCategory, preview, ...filter } = body;
      // Preview reports what a filter matches; the destination only appears in the
      // message the caller composes around it.
      return preview ? previewReassign(filter) : reassignLineItems(filter, toCategory);
    },
    {
      body: t.Object({
        toCategory: t.String({ minLength: 1 }),
        preview: t.Optional(t.Boolean()),
        fromCategory: t.Optional(t.String()),
        merchant: t.Optional(t.String()),
        month: t.Optional(t.String({ pattern: monthPattern })),
        transactionIds: t.Optional(t.Array(t.Number())),
        uncategorizedOnly: t.Optional(t.Boolean()),
      }),
    },
  );

export type App = typeof app;
