import { useBudget } from "../api/queries";
import { money } from "../lib/format";

/**
 * The page's one loud element: how much can leave the account on payday.
 *
 * Replaces the savings rate, which needed an income figure the database rarely has
 * and expressed the answer as a percentage — abstract where an amount is an
 * instruction. When the inputs are missing this says which one and for how long,
 * rather than showing a bare dash.
 */
export function SetAside({ month }: { month: string }) {
  const budget = useBudget(month);

  if (!budget.data) return null;
  const b = budget.data;

  return (
    <section>
      <h2 className="text-xs uppercase tracking-widest text-ink-300">Отложить в этом месяце</h2>

      {b.setAsideMinor !== null ? (
        <>
          <p className="tnum mt-3 text-5xl leading-none font-semibold text-gain sm:text-6xl">
            {money(b.setAsideMinor)} zł
          </p>
          <p className="mt-2 text-sm text-ink-300">в день зарплаты, до трат</p>
        </>
      ) : (
        <>
          <p className="mt-3 text-5xl leading-none font-semibold text-ink-300 sm:text-6xl">—</p>
          <p className="mt-3 max-w-md text-sm text-ink-300">
            {b.reason === "no-base-income"
              ? "Добавьте зарплату в настройках, чтобы посчитать."
              : `Соберу за ${b.monthsNeeded} ${monthWord(b.monthsNeeded)}. Записано ${b.monthsObserved} из 3.`}
          </p>
        </>
      )}

      <dl className="mt-6 max-w-sm space-y-2 text-sm">
        {/* Shown even when the headline figure is still unknown: the salary is the
            one input already declared, and hiding it reads as "not saved". */}
        <Row
          label="Зарплата"
          value={b.baseIncomeMinor === null ? "—" : money(b.baseIncomeMinor)}
          hint="база, без переработок"
        />
        <Row
          label="Обязательное"
          value={money(b.committedMinor)}
          hint="каждый месяц одно и то же"
        />
        <Row
          label="На жизнь"
          value={b.flexibleAverageMinor === null ? "…" : money(b.flexibleAverageMinor)}
          hint={b.flexibleAverageMinor === null ? "нужно 3 месяца истории" : "среднее за 3 месяца"}
        />
        <div className="border-t border-ink-700 pt-2">
          <Row
            label="Остаётся"
            value={b.setAsideMinor === null ? "—" : money(b.setAsideMinor)}
            hint=""
          />
        </div>
      </dl>
    </section>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-100">
        {label}
        {/* The hint is dimmer than the label but still readable: ink-700 is a border
            colour and disappears against the page. */}
        {hint && <span className="ml-2 hidden text-xs text-ink-300 sm:inline">{hint}</span>}
      </dt>
      <dd className="tnum tabular-nums whitespace-nowrap">{value}</dd>
    </div>
  );
}

/** Russian needs the noun to agree with the count: 1 месяц, 2 месяца, 5 месяцев. */
function monthWord(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return "месяц";
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return "месяца";
  return "месяцев";
}
