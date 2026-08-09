import { createHash } from "node:crypto";

/**
 * Reduces a merchant name to a stable key.
 *
 * The same shop reaches us spelled differently: a receipt says "Żabka", the PKO
 * statement says "ZABKA NANO Z1234 WARSZAWA". Diacritics, punctuation, casing and
 * bank reference codes are all removed so those spellings converge.
 *
 * ponytail: format and city suffixes ("nano", "warszawa") survive, so a receipt and a
 * statement line for the same purchase still hash differently. Collapsing them needs a
 * stop-word list, which would merge distinct branches of a chain and corrupt the
 * per-merchant averages. Receipt-to-statement matching is phase 5 and belongs there,
 * keyed on amount and date rather than on the name.
 */
export function normalizeMerchant(raw: string): string {
  return (
    raw
      .normalize("NFD")
      // Strip combining marks left by NFD: ż becomes z, ó becomes o.
      .replace(/[\u0300-\u036f]/g, "")
      // ł carries no combining mark, so NFD leaves it intact.
      .replace(/ł/gi, "l")
      .toLowerCase()
      // Collapse dotted abbreviations first ("o.o." -> "oo", "S.A." -> "sa") so the
      // punctuation-to-space rule below does not split them into single letters.
      .replace(/\b([a-z])\.(?=[a-z]\b|[a-z]\.)/g, "$1")
      .replace(/[^\w\s]/g, " ")
      // Drop bank reference codes anywhere in the string, not just at the end: PKO
      // writes "ZABKA NANO Z1234 WARSZAWA", so a trailing-only rule leaves the code in
      // and the receipt spelling ("Żabka") would hash differently.
      // A code is 3+ digits, optionally prefixed by one letter. Shorter numbers and
      // digit-letter mixes ("24", "24h") are part of the name and survive.
      .replace(/(^|\s)[a-z]?\d{3,}(?=\s|$)/gi, "$1")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Fingerprint of a transaction: same day, same amount, same merchant.
 *
 * Backed by a unique index, so a repeat submission is rejected by the database
 * rather than relying on a prior read.
 */
export function computeDedupHash(input: {
  occurredOn: number;
  totalMinor: number;
  merchantNorm: string;
}): string {
  return createHash("sha256")
    .update(`${input.occurredOn}|${input.totalMinor}|${input.merchantNorm}`)
    .digest("hex");
}
