import type { CategorySlice } from "@paragon/shared";
import { getMonthSummary, getCategoryBreakdown } from "./summary";
import { shiftMonth } from "./month";

export type CategoryDelta = {
  name: string;
  totalMinor: number;
  previousMinor: number;
  deltaMinor: number;
  deltaPercent: number | null;
};

export type PeriodSummary = {
  month: string;
  incomeMinor: number;
  spentMinor: number;
  keptMinor: number;
  savingsRate: number | null;
  previous: { month: string; spentMinor: number; savingsRate: number | null };
  spentDeltaMinor: number;
  categories: CategoryDelta[];
};

function byName(slices: CategorySlice[]): Map<string, number> {
  return new Map(slices.map((s) => [s.name, s.totalMinor]));
}

/**
 * A month's figures alongside the month before it.
 *
 * The comparison is the whole point: a total on its own says nothing, while "8% more
 * than last month, and groceries up 42%" is a conclusion. The research behind the spec
 * found the commonest reason people abandon trackers is logging faithfully and never
 * seeing anything stand out.
 */
export function getSummary(month: string): PeriodSummary {
  const current = getMonthSummary(month);
  const previousMonth = shiftMonth(month, -1);
  const previous = getMonthSummary(previousMonth);

  const currentSlices = byName(getCategoryBreakdown(month));
  const previousSlices = byName(getCategoryBreakdown(previousMonth));

  // A category that vanished this month is as informative as one that appeared, so
  // the union of both months is walked rather than just this month's.
  const names = new Set([...currentSlices.keys(), ...previousSlices.keys()]);

  const categories: CategoryDelta[] = [...names]
    .map((name) => {
      const totalMinor = currentSlices.get(name) ?? 0;
      const previousMinor = previousSlices.get(name) ?? 0;
      return {
        name,
        totalMinor,
        previousMinor,
        deltaMinor: totalMinor - previousMinor,
        // No baseline means no percentage: "+∞%" for a brand-new category is noise.
        deltaPercent:
          previousMinor === 0
            ? null
            : Math.round(((totalMinor - previousMinor) / previousMinor) * 100),
      };
    })
    .sort((a, b) => b.totalMinor - a.totalMinor);

  return {
    month,
    incomeMinor: current.incomeMinor,
    spentMinor: current.spentMinor,
    keptMinor: current.keptMinor,
    savingsRate: current.savingsRate,
    previous: {
      month: previousMonth,
      spentMinor: previous.spentMinor,
      savingsRate: previous.savingsRate,
    },
    spentDeltaMinor: current.spentMinor - previous.spentMinor,
    categories,
  };
}
