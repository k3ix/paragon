import { z } from "zod";
import { getSummary, type CategoryDelta } from "../../services/report";
import { formatMinor } from "../../money";

export const def = {
  name: "get_summary",
  config: {
    title: "Summarise a month",
    description:
      "Reports a month's income, spending and savings rate, how each compares with the " +
      "month before, and which categories moved most. Use for questions like " +
      '"how was August", "what changed since July" or "where did the money go". ' +
      "Amounts are in PLN.",
    inputSchema: {
      month: z.string().describe('Month to summarise, "YYYY-MM"'),
    },
  },
};

/** "+42%" / "-12%" / "new" — the shape a person reads rather than a raw ratio. */
function changeLabel(delta: CategoryDelta): string {
  if (delta.deltaPercent === null) return delta.totalMinor === 0 ? "gone" : "new";
  const sign = delta.deltaPercent > 0 ? "+" : "";
  return `${sign}${delta.deltaPercent}%`;
}

export async function handler(input: { month: string }) {
  try {
    const s = getSummary(input.month);

    const rate = s.savingsRate === null ? "n/a (no income recorded)" : `${s.savingsRate}%`;
    const previousRate = s.previous.savingsRate === null ? "n/a" : `${s.previous.savingsRate}%`;
    const spentChange =
      s.spentDeltaMinor === 0
        ? "the same as"
        : `${formatMinor(Math.abs(s.spentDeltaMinor))} ${s.spentDeltaMinor > 0 ? "more" : "less"} than`;

    const lines = [
      `${s.month}`,
      `  Income:  ${formatMinor(s.incomeMinor)}`,
      `  Spent:   ${formatMinor(s.spentMinor)} — ${spentChange} ${s.previous.month}`,
      `  Kept:    ${formatMinor(s.keptMinor)} (${rate}, previously ${previousRate})`,
      "",
      "  By category:",
      ...s.categories
        .filter((c) => c.totalMinor > 0 || c.previousMinor > 0)
        .map(
          (c) =>
            `    ${c.name}: ${formatMinor(c.totalMinor)} (${changeLabel(c)}, was ${formatMinor(c.previousMinor)})`,
        ),
    ];

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Could not summarise: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}
