import { z } from "zod";
import { TRANSACTION_TYPES, SCOPES, SOURCES } from "../enums";

export const lineItemSchema = z.object({
  amount: z.union([z.string(), z.number()]).describe('Line amount, e.g. "124.30" or "124,30"'),
  category: z.string().describe('Category path, e.g. "Food/Groceries"'),
  name: z.string().optional().describe("What was bought, as printed on the receipt"),
  note: z.string().optional(),
});

export const addTransactionSchema = z.object({
  date: z.string().describe("Transaction date, YYYY-MM-DD"),
  total: z.union([z.string(), z.number()]).describe("Total amount as printed on the receipt"),
  type: z.enum(TRANSACTION_TYPES).default("expense"),
  currency: z.string().length(3).default("PLN"),
  fxRate: z.number().optional().describe("Rate against PLN on that date, e.g. 4.33"),
  merchant: z.string().optional().describe("Merchant name as printed"),
  payer: z.string().optional(),
  scope: z.enum(SCOPES).optional(),
  source: z.enum(SOURCES).optional(),
  account: z.string().optional(),
  note: z.string().optional(),
  startsPeriod: z
    .boolean()
    .optional()
    .describe(
      "Income only. False when the money was earned earlier and merely surfaced now — " +
        "a gift, a refund, a returned deposit. Such income must not open a new pay period.",
    ),
  lineItems: z
    .array(lineItemSchema)
    .optional()
    .describe("Receipt breakdown. Omit for a single-category expense."),
});

/**
 * The shape callers pass in: `type` and `currency` are optional because the schema
 * supplies defaults. `z.infer` would describe the parsed output, where both are
 * already filled in, and would wrongly force every caller to spell them out.
 */
export type AddTransactionInput = z.input<typeof addTransactionSchema>;

/** The shape after parsing, with defaults applied. */
export type ParsedTransaction = z.output<typeof addTransactionSchema>;
