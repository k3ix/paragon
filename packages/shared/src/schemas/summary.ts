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
