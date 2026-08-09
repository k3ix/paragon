export const TRANSACTION_TYPES = ["expense", "income", "transfer"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const SCOPES = ["personal", "shared"] as const;
export type Scope = (typeof SCOPES)[number];

export const SOURCES = ["card", "cash", "transfer"] as const;
export type Source = (typeof SOURCES)[number];
