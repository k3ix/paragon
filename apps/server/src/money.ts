/**
 * Parses a human-written amount into an integer count of minor units (grosze).
 *
 * Works on the string representation rather than multiplying by 100, because
 * 184.20 * 100 evaluates to 18419.999999999996 under IEEE 754 and truncates
 * to a wrong value. Receipts arrive in both "184,20" and "184.20" forms.
 */
export function parseAmountToMinor(value: string | number): number {
  const raw = typeof value === "number" ? value.toString() : value.trim();
  if (raw === "") throw new Error("Amount is empty");

  const normalized = raw.replace(/[\s ]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    throw new Error(`Not a valid amount: ${value}`);
  }

  const negative = normalized.startsWith("-");
  const digits = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ""] = digits.split(".");

  // Pad or round the fractional part to exactly two digits.
  const twoDigits =
    fraction.length <= 2
      ? fraction.padEnd(2, "0")
      : String(Math.round(Number(`0.${fraction}`) * 100)).padStart(2, "0");

  const minor = Number(whole) * 100 + Number(twoDigits);
  return negative ? -minor : minor;
}

/** Renders minor units back as a decimal string with two places. */
export function formatMinor(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}
