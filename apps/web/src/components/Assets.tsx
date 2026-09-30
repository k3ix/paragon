import { useAssets } from "../api/queries";
import { money } from "../lib/format";

/**
 * What is held, as against what moved.
 *
 * The rest of the dashboard answers "where did the month go". This answers "what do we
 * have", which is a different question with a different rhythm: no periods, no
 * comparison to last month, just balances and what they have earned. Everyday cards
 * are deliberately absent — their balance would be wrong by lunchtime.
 */
export function Assets() {
  const assets = useAssets();

  if (assets.isPending) return <p className="text-sm text-ink-300">Загрузка…</p>;
  if (assets.error || !assets.data) {
    return <p className="text-sm text-loss">Не удалось загрузить. Сервер запущен?</p>;
  }

  const a = assets.data;
  const empty = a.accounts.length === 0 && a.holdings.length === 0;

  return (
    <div className="space-y-10">
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 className="text-xs uppercase tracking-widest text-ink-300">Всего</h2>
        </div>
        <p className="tnum mt-2 text-3xl leading-none font-semibold whitespace-nowrap tabular-nums text-ink-100 sm:text-4xl">
          {money(a.totalMinor)} <span className="text-xl sm:text-2xl">zł</span>
        </p>
      </section>

      {empty && (
        <p className="text-sm text-ink-300">
          Пока ничего не записано. Счета и вложения вносятся через чат.
        </p>
      )}

      <Warnings
        reconciliation={a.reconciliation}
        expiringPromos={a.expiringPromos}
        staleValuations={a.staleValuations}
      />

      {a.accounts.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-widest text-ink-300">Счета</h2>
          <ul className="mt-4 divide-y divide-line">
            {a.accounts.map((account) => (
              <li
                key={account.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"
              >
                <div>
                  <p className="text-ink-100">{account.name}</p>
                  {account.rateBp !== null && (
                    <p className="tnum text-sm text-ink-300">
                      {(account.rateBp / 100).toFixed(2)}%
                      {account.promoUntil && ` до ${account.promoUntil}`}
                    </p>
                  )}
                </div>
                <p className="tnum whitespace-nowrap tabular-nums text-ink-100">
                  {money(account.balanceMinor)} zł
                </p>
              </li>
            ))}
          </ul>
          <p className="tnum mt-3 flex justify-between text-sm text-ink-300">
            <span>Итого по счетам</span>
            <span className="tabular-nums">{money(a.accountsTotalMinor)} zł</span>
          </p>
        </section>
      )}

      {a.holdings.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-widest text-ink-300">Вложения</h2>
          <ul className="mt-4 divide-y divide-line">
            {a.holdings.map((holding) => (
              <li key={holding.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-ink-100">{holding.name}</p>
                  <p className="tnum whitespace-nowrap tabular-nums text-ink-100">
                    {holding.valueMinor === null ? (
                      <span className="text-ink-300">оценки пока нет</span>
                    ) : (
                      `${money(holding.valueMinor)} zł`
                    )}
                  </p>
                </div>
                <div className="tnum mt-1 flex flex-wrap justify-between gap-x-4 text-sm text-ink-300">
                  <span>вложено {money(holding.investedMinor)} zł</span>
                  {holding.growthMinor !== null && (
                    <span className={holding.growthMinor >= 0 ? "text-gain" : "text-loss"}>
                      {holding.growthMinor >= 0 ? "+" : ""}
                      {money(holding.growthMinor)} zł
                      {holding.growthPercent !== null &&
                        ` · ${holding.growthPercent > 0 ? "+" : ""}${holding.growthPercent}%`}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="tnum mt-3 flex justify-between text-sm text-ink-300">
            <span>Итого вложений</span>
            <span className="tabular-nums">{money(a.holdingsValueMinor)} zł</span>
          </p>
        </section>
      )}
    </div>
  );
}

type WarningProps = {
  reconciliation: { accountId: number; name: string; differenceMinor: number }[];
  expiringPromos: { id: number; name: string; promoUntil: string }[];
  staleValuations: { id: number; name: string; valuedAt: string | null }[];
};

/**
 * Silent unless something is actually wrong.
 *
 * A warning that is always on is one nobody reads, which is exactly why cards are not
 * tracked: savings movements are few and deliberate, so a mismatch here means a
 * transfer really was forgotten.
 */
function Warnings({ reconciliation, expiringPromos, staleValuations }: WarningProps) {
  const lines = [
    ...reconciliation.map((gap) => ({
      key: `rec-${gap.accountId}`,
      text: `Не сходится: ${gap.name} — разница ${money(gap.differenceMinor)} zł. Вероятно, пропущен перевод.`,
    })),
    ...expiringPromos.map((promo) => ({
      key: `promo-${promo.id}`,
      text: `Промо-ставка ${promo.name} заканчивается ${promo.promoUntil}.`,
    })),
    ...staleValuations.map((stale) => ({
      key: `stale-${stale.id}`,
      text: `Оценка ${stale.name} не обновлялась с ${stale.valuedAt}.`,
    })),
  ];

  if (lines.length === 0) return null;

  return (
    <section className="space-y-1">
      {lines.map((line) => (
        <p key={line.key} className="text-sm text-loss">
          {line.text}
        </p>
      ))}
    </section>
  );
}
