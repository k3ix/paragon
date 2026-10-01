import { assetsSummary, listLots } from "../../services/assets";
import { reconcileAccounts } from "../../services/reconcile";
import { formatMinor } from "../../money";

export const def = {
  name: "list_assets",
  config: {
    title: "List assets",
    description:
      "Returns every tracked account and holding with its id, balance or value, and rate. " +
      "Call this before recording interest, a transfer to savings, or a revaluation, so that " +
      "ids and names match what already exists. Everyday cards are deliberately not tracked, " +
      "so a card purchase names no account.",
  },
};

export async function handler() {
  const summary = assetsSummary();
  const gaps = reconcileAccounts();

  if (summary.accounts.length === 0 && summary.holdings.length === 0) {
    return {
      content: [{ type: "text" as const, text: "No accounts or holdings recorded yet." }],
    };
  }

  const lines: string[] = [`Total: ${formatMinor(summary.totalMinor)}`, ""];

  if (summary.accounts.length) {
    lines.push("Accounts:");
    for (const a of summary.accounts) {
      const rate = a.rateBp === null ? "" : ` at ${(a.rateBp / 100).toFixed(2)}%`;
      const promo = a.promoUntil ? ` (promo until ${a.promoUntil})` : "";
      lines.push(`  #${a.id} ${a.name}: ${formatMinor(a.balanceMinor)}${rate}${promo}`);
    }
    lines.push("");
  }

  if (summary.holdings.length) {
    lines.push("Holdings:");
    for (const h of summary.holdings) {
      const value = h.valueMinor === null ? "not valued yet" : formatMinor(h.valueMinor);
      const growth =
        h.growthMinor === null
          ? ""
          : ` (${h.growthMinor >= 0 ? "+" : ""}${formatMinor(h.growthMinor)})`;
      const valued = h.valuedAt ? `, valued ${h.valuedAt}` : "";
      // Says whether purchases are recorded, so a caller knows if add_lot is needed.
      const lotCount = listLots(h.id).length;
      const purchases = lotCount > 0 ? `, ${lotCount} purchases` : "";
      lines.push(
        `  #${h.id} ${h.name} [${h.kind}]: invested ${formatMinor(h.investedMinor)}, now ${value}${growth}${valued}${purchases}`,
      );
    }
    lines.push("");
  }

  for (const gap of gaps) {
    lines.push(
      `Does not reconcile: ${gap.name} says ${formatMinor(gap.statedMinor)}, ` +
        `movements give ${formatMinor(gap.expectedMinor)} — a movement is probably missing.`,
    );
  }

  for (const stale of summary.staleValuations) {
    lines.push(`Valuation is stale: ${stale.name} last valued ${stale.valuedAt}.`);
  }

  for (const promo of summary.expiringPromos) {
    lines.push(`Promotional rate ends soon: ${promo.name} on ${promo.promoUntil}.`);
  }

  return { content: [{ type: "text" as const, text: lines.join("\n").trimEnd() }] };
}
