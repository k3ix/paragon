import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "./client";

/**
 * Turns an Eden error into something worth showing a person.
 *
 * The server sets a status without a body — returning one would widen every route's
 * response type — so the status is what carries the meaning.
 */
function errorMessage(error: { status?: number; value?: unknown }): string {
  if (error.status === 404) return "Эта запись больше не существует.";
  if (error.status === 422) {
    const value = error.value as { error?: string } | undefined;
    return value?.error ?? "Изменение отклонено: проверьте суммы и категорию.";
  }
  return "Не удалось сохранить. Сервер запущен?";
}

/**
 * Everything on the dashboard derives from the same rows, so a single edit invalidates
 * all of it. The lists are small and local; a targeted cache update would be more code
 * for no perceptible gain.
 */
function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    for (const key of [
      "summary",
      "trend",
      "breakdown",
      "transactions",
      "categories",
      "merchants",
      "budget",
      "pace",
      "tree",
      "commitments",
      "savings",
      "runway",
    ]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };
}

type LinePatch = { amount: string; category?: string; note?: string };

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

export function useBudget(month: string) {
  return useQuery({
    queryKey: ["budget", month],
    queryFn: async () => {
      const { data, error } = await client.api.budget.get({ query: { month } });
      if (error) throw error;
      return data;
    },
  });
}

export function usePace(month: string) {
  return useQuery({
    queryKey: ["pace", month],
    queryFn: async () => {
      const { data, error } = await client.api.pace.get({ query: { month } });
      if (error) throw error;
      return data;
    },
  });
}

export function useTree(month: string) {
  return useQuery({
    queryKey: ["tree", month],
    queryFn: async () => {
      const { data, error } = await client.api.tree.get({ query: { month } });
      if (error) throw error;
      return data;
    },
  });
}

export function useSavings(month: string) {
  return useQuery({
    queryKey: ["savings", month],
    queryFn: async () => {
      const { data, error } = await client.api.savings.get({ query: { month } });
      if (error) throw error;
      return data;
    },
  });
}

export function useRunway(month: string) {
  return useQuery({
    queryKey: ["runway", month],
    queryFn: async () => {
      const { data, error } = await client.api.runway.get({ query: { month } });
      if (error) throw error;
      return data;
    },
  });
}

export function useCommitments() {
  return useQuery({
    queryKey: ["commitments"],
    queryFn: async () => {
      const { data, error } = await client.api.commitments.get();
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateCommitment() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (input: {
      kind: "income" | "expense";
      name: string;
      amountMinor: number;
      categoryId?: number | null;
      activeFrom: string;
    }) => {
      const { data, error } = await client.api.commitments.post(input);
      if (error) throw new Error(errorMessage(error));
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateCommitment() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (input: { id: number; name?: string; amountMinor?: number }) => {
      const { id, ...patch } = input;
      const { data, error } = await client.api.commitments({ id: String(id) }).patch(patch);
      if (error) throw new Error(errorMessage(error));
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useEndCommitment() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (input: { id: number; month: string }) => {
      const { data, error } = await client.api
        .commitments({ id: String(input.id) })
        .delete(undefined, { query: { month: input.month } });
      if (error) throw new Error(errorMessage(error));
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateTransaction() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (input: {
      id: number;
      date?: string;
      total?: string;
      merchant?: string | null;
      note?: string | null;
      lineItems?: LinePatch[];
    }) => {
      const { id, ...patch } = input;
      const { data, error } = await client.api.transactions({ id: String(id) }).patch(patch);
      if (error) throw new Error(errorMessage(error));
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteTransaction() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await client.api.transactions({ id: String(id) }).delete();
      if (error) throw new Error(errorMessage(error));
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useCreateCategory() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (input: { name: string; parentId?: number | null; isFixed?: boolean }) => {
      const { data, error } = await client.api.categories.post(input);
      if (error) throw new Error(errorMessage(error));
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateCategory() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (input: {
      id: number;
      name?: string;
      parentId?: number | null;
      isFixed?: boolean;
      isOccasional?: boolean;
    }) => {
      const { id, ...patch } = input;
      const { data, error } = await client.api.categories({ id: String(id) }).patch(patch);
      if (error) throw new Error(errorMessage(error));
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useArchiveCategory() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await client.api.categories({ id: String(id) }).delete();
      if (error) throw new Error(errorMessage(error));
      return data;
    },
    onSuccess: invalidate,
  });
}
