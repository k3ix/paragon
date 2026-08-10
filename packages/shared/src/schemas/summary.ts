export type MonthSummary = {
  month: string;
  incomeMinor: number;
  spentMinor: number;
  keptMinor: number;
  savingsRate: number | null;
};

export type TrendPoint = {
  month: string;
  incomeMinor: number;
  spentMinor: number;
  savingsRate: number | null;
};

export type CategorySlice = {
  categoryId: number | null;
  name: string;
  path: string;
  totalMinor: number;
  share: number;
};

/**
 * Spending for a month as a tree, so a parent's total and its children's split are
 * visible at once. A flat rollup hides exactly the breakdown that was entered by hand.
 */
export type CategoryTreeNode = {
  categoryId: number | null;
  name: string;
  /** Full path, e.g. "Еда/Продукты". Used to filter purchases by branch. */
  path: string;
  totalMinor: number;
  /** Percentage of the month's total spending, rounded. */
  share: number;
  previousMinor: number;
  /** totalMinor − previousMinor. Positive means this month cost more. */
  deltaMinor: number;
  children: CategoryTreeNode[];
};

/** A category and its children. Depth is unlimited. */
export type CategoryNode = {
  id: number;
  name: string;
  isFixed: boolean;
  children: CategoryNode[];
};
