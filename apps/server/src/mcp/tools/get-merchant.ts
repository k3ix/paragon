import { z } from "zod";
import { getMerchant } from "../../services/merchants";
import { formatMinor } from "../../money";

export const def = {
  name: "get_merchant",
  config: {
    title: "Look up a merchant",
    description:
      "Returns what was decided about a shop previously: its usual category, how many times " +
      "it has been recorded, and the average amount. ALWAYS call this before add_transactions " +
      "for each merchant on the receipt, and reuse the category it returns. This is what keeps " +
      "the same shop in the same category month after month instead of drifting. " +
      "A null category means the shop is new or has only ever appeared on split receipts — " +
      "choose a category from list_categories in that case.",
    inputSchema: {
      name: z.string().describe("Merchant name as printed on the receipt or statement"),
    },
  },
};

export async function handler(input: { name: string }) {
  const memory = getMerchant(input.name);

  if (!memory) {
    return {
      content: [
        {
          type: "text" as const,
          text: `No record of "${input.name}". It is new — pick a category from list_categories.`,
        },
      ],
    };
  }

  const parts = [
    `Merchant: ${memory.nameNorm}`,
    `Usual category: ${memory.categoryPath ?? "none learned yet"}`,
    `Seen: ${memory.seenCount} time${memory.seenCount === 1 ? "" : "s"}`,
  ];
  if (memory.averageMinor !== null) {
    parts.push(`Average amount: ${formatMinor(memory.averageMinor)}`);
  }

  return { content: [{ type: "text" as const, text: parts.join("\n") }] };
}
