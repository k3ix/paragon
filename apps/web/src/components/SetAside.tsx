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

  /*
   * Until three months of history exist there is no figure to show, and a giant dash
   * above an empty breakdown was taking a third of the screen to say "not yet". While
   * waiting, this collapses to a single line stating what is missing.
   */
  if (b.setAsideMinor === null) {
    return (
      <section className="border-t border-ink-700 pt-4 text-sm text-ink-300">
        <span className="text-ink-100">Сколько откладывать</span>{" "}
        {b.reason === "no-base-income"
          ? "— за этот месяц зарплата не задана. Задаётся в настройках."
          : `— посчитаю через ${b.monthsNeeded} ${monthWord(b.monthsNeeded)}, нужно 3 месяца трат (записан ${b.monthsObserved}).`}
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-xs uppercase tracking-widest text-ink-300">Откладывать в день зарплаты</h2>

      <p className="tnum mt-2 text-4xl leading-none font-semibold text-gain sm:text-5xl">
        {money(b.setAsideMinor)} zł
      </p>

      {/* Reached only once the figure exists, so every input below is known. */}
      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <Row label="Зарплата" value={money(b.baseIncomeMinor ?? 0)} hint="база" />
        <Row label="− обязательное" value={money(b.committedMinor)} hint="" />
        <Row
          label="− на жизнь"
          value={money(b.flexibleAverageMinor ?? 0)}
          hint="среднее за 3 месяца"
        />
      </dl>
    </section>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-ink-300">
        {label}
        {hint && <span className="ml-1 hidden text-xs text-ink-300 sm:inline">({hint})</span>}
      </dt>
      <dd className="tnum whitespace-nowrap tabular-nums text-ink-100">{value}</dd>
    </div>
  );
}

/** Russian needs the noun to agree with the count: 1 месяц, 2 месяца, 5 месяцев. */
function monthWord(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return "месяц";
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return "месяца";
  return "месяцев";
}
