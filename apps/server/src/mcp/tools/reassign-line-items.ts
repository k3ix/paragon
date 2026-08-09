import { z } from "zod";
import { previewReassign, reassignLineItems } from "../../services/reassign";
import { formatMinor } from "../../money";

const filterSchema = {
  fromCategory: z
    .string()
    .optional()
    .describe('Category path to move out of, including everything beneath it, e.g. "Home"'),
  merchant: z.string().optional().describe("Merchant name; matched however it was spelled"),
  month: z.string().optional().describe('Restrict to one month, "YYYY-MM"'),
  transactionIds: z.array(z.number()).optional().describe("Specific transactions to move"),
  uncategorizedOnly: z.boolean().optional().describe("Only lines that have no category yet"),
};

export const def = {
  name: "reassign_line_items",
  config: {
    title: "Move spending to another category",
    description:
      "Moves matched line items into a different category, rewriting past months as well as " +
      "the current one. This is how the taxonomy gets reorganised: splitting a category, " +
      "merging two, or correcting where a shop has always been filed. " +
      "Merging is this tool plus set_merchant_category or update_category — there is no " +
      "separate merge tool. " +
      "Set preview: true first when the filter could match many lines; it reports the count " +
      "and the merchants involved without changing anything. There is no undo, so a filter " +
      "that matches more than expected should be narrowed rather than run. " +
      "At least one filter is required. Amounts are never changed, only categories.",
    inputSchema: {
      ...filterSchema,
      toCategory: z.string().describe('Destination category path, e.g. "Home/Repairs"'),
      preview: z.boolean().optional().describe("Report what would move without moving it"),
    },
  },
};

export async function handler(input: {
  fromCategory?: string;
  merchant?: string;
  month?: string;
  transactionIds?: number[];
  uncategorizedOnly?: boolean;
  toCategory: string;
  preview?: boolean;
}) {
  const { toCategory, preview, ...filter } = input;

  try {
    if (preview) {
      const result = previewReassign(filter);
      if (result.count === 0) {
        return {
          content: [{ type: "text" as const, text: "Nothing matches that filter." }],
        };
      }
      const who = result.sampleMerchants.length
        ? ` Merchants: ${result.sampleMerchants.join(", ")}.`
        : "";
      return {
        content: [
          {
            type: "text" as const,
            text:
              `${result.count} line${result.count === 1 ? "" : "s"} totalling ` +
              `${formatMinor(result.totalMinor)} would move to ${toCategory}.${who} ` +
              `Run again without preview to apply.`,
          },
        ],
      };
    }

    const result = reassignLineItems(filter, toCategory);

    if (result.moved === 0) {
      return {
        content: [
          { type: "text" as const, text: "Nothing matched that filter; nothing changed." },
        ],
      };
    }

    const who = result.sampleMerchants.length
      ? ` Affected merchants: ${result.sampleMerchants.join(", ")}.`
      : "";
    return {
      content: [
        {
          type: "text" as const,
          text: `Moved ${result.moved} line${result.moved === 1 ? "" : "s"} to ${result.toCategory}.${who} Past months are recalculated.`,
        },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Could not reassign: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}
