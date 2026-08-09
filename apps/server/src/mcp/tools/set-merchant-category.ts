import { z } from "zod";
import { setMerchantCategory } from "../../services/merchants";

export const def = {
  name: "set_merchant_category",
  config: {
    title: "Pin a merchant to a category",
    description:
      "Sets the category a shop should default to from now on, overriding whatever was " +
      'learned automatically. Use when the user says something like "Rossmann is household, ' +
      'not groceries". This affects future transactions only and does not rewrite past ones.',
    inputSchema: {
      name: z.string().describe("Merchant name"),
      category: z.string().describe('Category path, e.g. "Home/Cleaning"'),
    },
  },
};

export async function handler(input: { name: string; category: string }) {
  try {
    const updated = setMerchantCategory(input.name, input.category);
    return {
      content: [
        {
          type: "text" as const,
          text: `"${updated.nameNorm}" now defaults to ${updated.categoryPath}. Past transactions are unchanged.`,
        },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Could not set: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}
