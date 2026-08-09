import { Elysia, t } from "elysia";
import {
  listCategories,
  createCategory,
  updateCategory,
  archiveCategory,
} from "./services/categories";
import { getMonthSummary, getMonthlyTrend, getCategoryBreakdown } from "./services/summary";
import { listTransactions } from "./services/queries";
import { updateTransaction, deleteTransaction } from "./services/transactions";
import { listMerchants } from "./services/merchants";

// Matches the shape "YYYY-MM". The month *number* is still validated in the service,
// because 2026-13 matches this pattern but is not a month.
const monthPattern = "^\\d{4}-\\d{2}$";
const monthQuery = t.Object({ month: t.String({ pattern: monthPattern }) });

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
      /requires line items/i.test(message)
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

  .get(
    "/transactions",
    ({ query }) =>
      listTransactions({
        month: query.month,
        type: query.type,
        limit: query.limit,
        offset: query.offset,
      }),
    {
      query: t.Object({
        month: t.Optional(t.String({ pattern: monthPattern })),
        type: t.Optional(t.String()),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 500 })),
        offset: t.Optional(t.Number({ minimum: 0 })),
      }),
    },
  )

  .get("/merchants", () => listMerchants())

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
    }),
  })

  .patch("/categories/:id", ({ params, body }) => updateCategory(Number(params.id), body), {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      name: t.Optional(t.String({ minLength: 1 })),
      parentId: t.Optional(t.Union([t.Number(), t.Null()])),
      isFixed: t.Optional(t.Boolean()),
    }),
  })

  .delete("/categories/:id", ({ params }) => archiveCategory(Number(params.id)), {
    params: t.Object({ id: t.String() }),
  });

export type App = typeof app;
