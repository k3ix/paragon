import { formatMinor } from "@paragon/shared";

/** Amount with a thousands separator, e.g. "1 234.56". Sign is kept. */
export function money(minor: number): string {
  const [whole, fraction] = formatMinor(minor).split(".");
  const negative = whole!.startsWith("-");
  const digits = negative ? whole!.slice(1) : whole!;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${negative ? "−" : ""}${grouped}.${fraction}`;
}

/** "2026-08" to "август 2026". */
export function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  const date = new Date(Date.UTC(Number(year), Number(m) - 1, 1));
  return date.toLocaleDateString("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Unix seconds to "9 авг.". */
export function dayLabel(occurredOn: number): string {
  return new Date(occurredOn * 1000).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Unix seconds to "воскресенье, 9 августа", for grouping headings. */
export function dayHeading(occurredOn: number): string {
  return new Date(occurredOn * 1000).toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/** The current month as "YYYY-MM". */
export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Shifts "YYYY-MM" by a signed number of months. */
export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  const total = year! * 12 + (m! - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/**
 * A day as text, whatever the client handed us.
 *
 * Eden parses date-shaped strings into Date objects on the way in. React cannot render
 * a Date — it throws "Objects are not valid as a React child" and unmounts the tree,
 * which shows up as a black screen — so every day that reaches the DOM goes through
 * here. The server stores and sends "YYYY-MM-DD"; this only undoes the client's
 * helpfulness.
 */
export function day(value: string | Date | null | undefined): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}
