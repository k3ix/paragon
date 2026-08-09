import { Elysia, t } from "elysia";
import { listCategories } from "./services/categories";
import { getMonthSummary, getMonthlyTrend, getCategoryBreakdown } from "./services/summary";
import { listTransactions } from "./services/queries";
import { listMerchants } from "./services/merchants";

// Matches the shape "YYYY-MM". The month *number* is still validated in the service,
// because 2026-13 matches this pattern but is not a month.
const monthPattern = "^\\d{4}-\\d{2}$";
const monthQuery = t.Object({ month: t.String({ pattern: monthPattern }) });

export const app = new Elysia({ prefix: "/api" })
  /*
   * A bad month reaches the services as a thrown Error. Without this it would surface
   * as a 500, which reads as "the server is broken" rather than "that is not a month".
   */
  .onError(({ code, error, set }) => {
    if (code === "VALIDATION") {
      set.status = 422;
      return { error: "Invalid query parameters" };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/^Invalid month/i.test(message)) {
      set.status = 422;
      return { error: message };
    }
    set.status = 500;
    return { error: message };
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

  .get("/merchants", () => listMerchants());

export type App = typeof app;
