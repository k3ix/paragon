import { z } from "zod";
import { addTransactionSchema, type AddTransactionInput } from "@paragon/shared";
import { addTransactions } from "../../services/transactions";
import { formatMinor, parseAmountToMinor } from "../../money";

export const def = {
  name: "add_transactions",
  config: {
    title: "Add transactions",
    description:
      "Records one or more transactions read from receipts, push notifications or a bank statement. " +
      "Call list_categories first so category paths match the existing tree, and call " +
      "get_merchant for each merchant to reuse the category that shop was filed under before. " +
      "Line item amounts must sum exactly to the transaction total; when a receipt covers several " +
      "categories, split it into a line per category. Omit lineItems when there is no breakdown — " +
      "one uncategorized line covering the total is written instead. Sending the same receipt twice " +
      "is safe: the duplicate is reported rather than recorded again.",
    inputSchema: {
      items: z.array(addTransactionSchema).describe("Transactions to record"),
    },
  },
};

export async function handler(input: { items: AddTransactionInput[] }) {
  try {
    const results = addTransactions(input.items);

    const lines = results.map((result, i) => {
      const item = input.items[i]!;
      const label = `${item.date} ${item.merchant ?? "(no merchant)"} ${formatMinor(
        parseAmountToMinor(item.total),
      )} ${item.currency ?? "PLN"}`;
      return result.status === "created"
        ? `Recorded #${result.id}: ${label}`
        : `Already recorded (#${result.id}): ${label}`;
    });

    const created = results.filter((r) => r.status === "created").length;
    const skipped = results.length - created;

    return {
      content: [
        {
          type: "text" as const,
          text: `${lines.join("\n")}\n\n${created} recorded${skipped ? `, ${skipped} already present` : ""}.`,
        },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Could not record: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}
