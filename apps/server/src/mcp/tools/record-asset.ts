import { z } from "zod";
import {
  createAccount,
  createHolding,
  revalueHolding,
  addLot,
  listHoldings,
} from "../../services/assets";
import { formatMinor } from "../../money";

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

export const inputSchema = {
  action: z
    .enum(["create_account", "create_holding", "revalue", "add_lot"])
    .describe(
      "create_account for a place money sits, create_holding for something invested in, " +
        "revalue to set what a holding is worth today, add_lot to record one purchase " +
        "with its date, quantity, price, rate and what it cost in PLN.",
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
  boughtOn: z.string().optional().describe("Day of the purchase, YYYY-MM-DD. Required for add_lot."),
  quantityMicro: z
    .number()
    .optional()
    .describe("Units bought × 1 000 000: 4.3823 units is 4382300. Required for add_lot."),
  priceMinor: z
    .number()
    .optional()
    .describe("Price per unit in the instrument's currency, minor units: 157.92 EUR is 15792."),
  costMinor: z
    .number()
    .optional()
    .describe("What the purchase cost in PLN as the broker reported it, minor units."),
  fxRate: z
    .number()
    .optional()
    .describe("Rate to PLN at purchase, in millionths: 4.2482 is 4248200."),
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
  action: "create_account" | "create_holding" | "revalue" | "add_lot";
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
  boughtOn?: string;
  quantityMicro?: number;
  priceMinor?: number;
  costMinor?: number;
  fxRate?: number;
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

  if (input.action === "add_lot") {
    if (input.id === undefined) throw new Error("add_lot needs the holding id");
    if (!input.boughtOn) throw new Error("add_lot needs boughtOn");
    if (input.quantityMicro === undefined) throw new Error("add_lot needs quantityMicro");
    if (input.priceMinor === undefined) throw new Error("add_lot needs priceMinor");
    if (input.costMinor === undefined) throw new Error("add_lot needs costMinor");

    const holding = listHoldings().find((h) => h.id === input.id);
    if (!holding) throw new Error(`Holding not found: ${input.id}`);

    const lot = addLot({
      holdingId: input.id,
      boughtOn: requireDay(input.boughtOn, "boughtOn"),
      quantityMicro: input.quantityMicro,
      priceMinor: input.priceMinor,
      currency: input.currency ?? "EUR",
      fxRate: input.fxRate ?? null,
      costMinor: input.costMinor,
    });

    return {
      content: [
        {
          type: "text" as const,
          text:
            `Recorded lot #${lot.id} for ${holding.name}: ` +
            `${(lot.quantityMicro / 1e6).toFixed(4)} units at ${formatMinor(lot.priceMinor)} ${lot.currency} ` +
            `on ${lot.boughtOn}, ${formatMinor(lot.costMinor)} PLN`,
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
