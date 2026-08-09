import { useQuery } from "@tanstack/react-query";
import { client } from "./client";

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await client.api.categories.get();
      if (error) throw error;
      return data;
    },
  });
}

export function useSummary(month: string) {
  return useQuery({
    queryKey: ["summary", month],
    queryFn: async () => {
      const { data, error } = await client.api.summary.get({ query: { month } });
      if (error) throw error;
      return data;
    },
  });
}

export function useTrend(month: string, count = 12) {
  return useQuery({
    queryKey: ["trend", month, count],
    queryFn: async () => {
      const { data, error } = await client.api.trend.get({ query: { month, count } });
      if (error) throw error;
      return data;
    },
  });
}

export function useBreakdown(month: string) {
  return useQuery({
    queryKey: ["breakdown", month],
    queryFn: async () => {
      const { data, error } = await client.api.breakdown.get({ query: { month } });
      if (error) throw error;
      return data;
    },
  });
}

export function useTransactions(month: string, limit = 50) {
  return useQuery({
    queryKey: ["transactions", month, limit],
    queryFn: async () => {
      const { data, error } = await client.api.transactions.get({ query: { month, limit } });
      if (error) throw error;
      return data;
    },
  });
}
