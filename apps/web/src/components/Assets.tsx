import { useState } from "react";
import { useAssets, useAccountHistory, useHoldingHistory } from "../api/queries";
import { money, dayLabel } from "../lib/format";

type Movement = {
  id: number;
  occurredOn: number;
  totalMinor: number;
  note: string | null;
  merchant: string | null;
  runningMinor: number;
};

/**
 * What is held, as against what moved.
 *
 * The rest of the dashboard answers "where did the month go". This answers "what do we
 * have", which is a different question with a different rhythm: no periods, no
 * comparison to last month, just balances and what they have earned. Everyday cards
 * are deliberately absent — their balance would be wrong by lunchtime.
 *
 * Each row opens onto its own history, because a figure with no provenance is the one
 * complaint this screen earned on its first day.
 */
export function Assets() {
  const assets = useAssets();
  const [openAccount, setOpenAccount] = useState<number | null>(null);
  const [openHolding, setOpenHolding] = useState<number | null>(null);

  if (assets.isPending) return <p className="text-sm text-ink-300">Загрузка…</p>;
  if (assets.error || !assets.data) {
    return <p className="text-sm text-loss">Не удалось загрузить. Сервер запущен?</p>;
  }

  const a = assets.data;
  const empty = a.accounts.length === 0 && a.holdings.length === 0;

  return (
    <div className="space-y-10">
      <section>
        <h2 className="text-xs uppercase tracking-widest text-ink-300">Всего</h2>
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
              <li key={account.id}>
                <button
                  type="button"
                  onClick={() => setOpenAccount(openAccount === account.id ? null : account.id)}
                  className="flex w-full flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-left hover:text-ink-100"
                >
                  <div>
                    <p className="text-ink-100">
                      {account.name}
                      <span className="ml-2 text-xs text-ink-300">
                        {openAccount === account.id ? "−" : "+"}
                      </span>
                    </p>
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
                </button>
                {openAccount === account.id && <AccountHistory id={account.id} />}
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
              <li key={holding.id}>
                <button
                  type="button"
                  onClick={() => setOpenHolding(openHolding === holding.id ? null : holding.id)}
                  className="w-full py-3 text-left hover:text-ink-100"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <p className="text-ink-100">
                      {holding.name}
                      <span className="ml-2 text-xs text-ink-300">
                        {openHolding === holding.id ? "−" : "+"}
                      </span>
                    </p>
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
                </button>
                {openHolding === holding.id && <HoldingHistory id={holding.id} />}
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

function AccountHistory({ id }: { id: number }) {
  const history = useAccountHistory(id);

  if (history.isPending) return <p className="pb-3 text-sm text-ink-300">Загрузка…</p>;
  if (history.error || !history.data) {
    return <p className="pb-3 text-sm text-loss">Не удалось загрузить историю.</p>;
  }

  return <Movements movements={history.data.movements} />;
}

function HoldingHistory({ id }: { id: number }) {
  const history = useHoldingHistory(id);

  if (history.isPending) return <p className="pb-3 text-sm text-ink-300">Загрузка…</p>;
  if (history.error || !history.data) {
    return <p className="pb-3 text-sm text-loss">Не удалось загрузить историю.</p>;
  }

  const { movements, lots, valuations } = history.data;

  return (
    <div className="space-y-5 pb-4">
      <div>
        <h3 className="text-xs uppercase tracking-widest text-ink-300">Движения</h3>
        <Movements movements={movements} />
      </div>

      {lots.length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-widest text-ink-300">Покупки</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {lots.map((lot) => (
              <li key={lot.id} className="tnum flex flex-wrap justify-between gap-x-4">
                <span className="text-ink-300">
                  {lot.boughtOn} · {(lot.quantityMicro / 1e6).toFixed(4)} ×{" "}
                  {money(lot.priceMinor)} {lot.currency}
                  {lot.fxRate !== null && ` @ ${(lot.fxRate / 1e6).toFixed(4)}`}
                </span>
                <span className="tabular-nums text-ink-100">{money(lot.costMinor)} zł</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {valuations.length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-widest text-ink-300">Оценки</h3>
          <Valuations valuations={valuations} />
        </div>
      )}
    </div>
  );
}

function Movements({ movements }: { movements: Movement[] }) {
  if (movements.length === 0) {
    return <p className="py-2 text-sm text-ink-300">Движений пока нет.</p>;
  }

  return (
    <ul className="mt-2 space-y-1 pb-1 text-sm">
      {movements.map((m) => (
        <li key={m.id} className="tnum flex flex-wrap justify-between gap-x-4">
          <span className="text-ink-300">
            {dayLabel(m.occurredOn)}
            {m.note && ` · ${m.note}`}
          </span>
          <span className="flex gap-4 tabular-nums">
            <span className={m.totalMinor >= 0 ? "text-gain" : "text-ink-100"}>
              {m.totalMinor >= 0 ? "+" : ""}
              {money(m.totalMinor)}
            </span>
            <span className="w-24 text-right text-ink-300">{money(m.runningMinor)} zł</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Below three points a chart is decoration, so the figures are listed instead. The
 * sparkline is inline SVG: no chart library is installed, and the page cannot reach a
 * CDN.
 */
function Valuations({ valuations }: { valuations: { id: number; valuedOn: string; valueMinor: number }[] }) {
  if (valuations.length < 3) {
    return (
      <ul className="mt-2 space-y-1 text-sm">
        {valuations.map((v) => (
          <li key={v.id} className="tnum flex justify-between gap-x-4">
            <span className="text-ink-300">{v.valuedOn}</span>
            <span className="tabular-nums text-ink-100">{money(v.valueMinor)} zł</span>
          </li>
        ))}
      </ul>
    );
  }

  const values = valuations.map((v) => v.valueMinor);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat line would divide by zero; draw it down the middle instead.
  const span = max - min || 1;
  const points = valuations
    .map((v, i) => {
      const x = (i / (valuations.length - 1)) * 100;
      const y = 30 - ((v.valueMinor - min) / span) * 28;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const first = valuations[0]!;
  const last = valuations[valuations.length - 1]!;

  return (
    <div className="mt-2">
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" className="h-12 w-full">
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          className="text-gain"
        />
      </svg>
      <div className="tnum mt-1 flex justify-between text-sm text-ink-300">
        <span>
          {first.valuedOn} · {money(first.valueMinor)} zł
        </span>
        <span>
          {last.valuedOn} · {money(last.valueMinor)} zł
        </span>
      </div>
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
