import { z } from "zod";
import { createAccount, createHolding, revalueHolding } from "../../services/assets";
import { formatMinor } from "../../money";

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

export const inputSchema = {
  action: z
    .enum(["create_account", "create_holding", "revalue"])
    .describe(
      "create_account for a place money sits, create_holding for something invested in, " +
        "revalue to set what a holding is worth today.",
    ),
  id: z.number().optional().describe("Holding to revalue. Required for revalue."),
  name: z.string().optional().describe("Required when creating."),
  kind: z
    .enum(["equity", "bond"])
    .optional()
    .describe("Required for create_holding: shares or bonds."),
  balanceMinor: z.number().optional().describe("Account balance today, in minor units."),
  openingMinor: z
    .number()
    .optional()
    .describe("Balance on the day the account entered the application. Reconciliation counts from here."),
  investedMinor: z.number().optional().describe("What was put into a holding, in minor units."),
  valueMinor: z.number().optional().describe("What a holding is worth now. Required for revalue."),
  valuedAt: z.string().optional().describe("Day of the valuation, YYYY-MM-DD. Required for revalue."),
  openedOn: z.string().optional().describe("YYYY-MM-DD the account entered the application."),
  rateBp: z.number().optional().describe("Annual rate in basis points: 4.25% is 425."),
  promoUntil: z.string().optional().describe("YYYY-MM-DD a promotional rate expires."),
  maturesOn: z.string().optional().describe("YYYY-MM-DD a bond matures."),
};

export const def = {
  name: "record_asset",
  config: {
    title: "Record an asset",
    description:
      "Creates an account or a holding, or sets what a holding is worth today. " +
      "Revaluation is deliberately not a transaction: the price moved, the money did not, " +
      "so it must never be recorded as income. Interest and coupons are the opposite — " +
      "those are real money and go through add_transactions as income with startsPeriod false.",
    inputSchema,
  },
};

export type RecordAssetInput = {
  action: "create_account" | "create_holding" | "revalue";
  id?: number;
  name?: string;
  kind?: "equity" | "bond";
  balanceMinor?: number;
  openingMinor?: number;
  investedMinor?: number;
  valueMinor?: number;
  valuedAt?: string;
  openedOn?: string;
  rateBp?: number;
  promoUntil?: string;
  maturesOn?: string;
};

function requireDay(value: string, field: string): string {
  if (!dayPattern.test(value)) {
    throw new Error(`Invalid ${field}, expected YYYY-MM-DD: ${value}`);
  }
  return value;
}

export async function handler(input: RecordAssetInput) {
  if (input.action === "create_account") {
    if (!input.name) throw new Error("create_account needs a name");
    const account = createAccount({
      name: input.name,
      balanceMinor: input.balanceMinor ?? 0,
      openingMinor: input.openingMinor ?? input.balanceMinor ?? 0,
      openedOn: input.openedOn ? requireDay(input.openedOn, "openedOn") : null,
      rateBp: input.rateBp ?? null,
      promoUntil: input.promoUntil ? requireDay(input.promoUntil, "promoUntil") : null,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: `Recorded account #${account.id}: ${account.name}, ${formatMinor(account.balanceMinor)}`,
        },
      ],
    };
  }

  if (input.action === "create_holding") {
    if (!input.name) throw new Error("create_holding needs a name");
    if (!input.kind) throw new Error("create_holding needs a kind: equity or bond");
    const holding = createHolding({
      name: input.name,
      kind: input.kind,
      investedMinor: input.investedMinor ?? 0,
      rateBp: input.rateBp ?? null,
      maturesOn: input.maturesOn ? requireDay(input.maturesOn, "maturesOn") : null,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: `Recorded holding #${holding.id}: ${holding.name} [${holding.kind}], invested ${formatMinor(holding.investedMinor)}`,
        },
      ],
    };
  }

  if (input.id === undefined) throw new Error("revalue needs the holding id");
  if (input.valueMinor === undefined) throw new Error("revalue needs valueMinor");
  if (!input.valuedAt) throw new Error("revalue needs valuedAt");

  const holding = revalueHolding(
    input.id,
    input.valueMinor,
    requireDay(input.valuedAt, "valuedAt"),
  );
  const growth = holding.valueMinor === null ? 0 : holding.valueMinor - holding.investedMinor;
  return {
    content: [
      {
        type: "text" as const,
        text:
          `Revalued #${holding.id} ${holding.name}: ${formatMinor(holding.valueMinor ?? 0)} ` +
          `on ${holding.valuedAt} (${growth >= 0 ? "+" : ""}${formatMinor(growth)} against invested)`,
      },
    ],
  };
}
