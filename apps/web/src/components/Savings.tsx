import { money } from "../lib/format";

type Summary = {
  incomeMinor: number;
  savedMinor: number;
  spentMinor: number;
  leftMinor: number;
  committedMinor: number;
  occasionalMinor: number;
  livingMinor: number;
  daysRemaining: number;
  perDayLeftMinor: number | null;
};

/**
 * One paycheque, split three ways.
 *
 * The screen used to state the same figures twice — two headline amounts, then a row
 * repeating them — because the split and the totals were built as separate blocks.
 * They are one fact: money arrived and went to three places, and the layout says so.
 */
export function Savings({ summary }: { summary: Summary }) {
  const s = summary;
  if (s.incomeMinor === 0 && s.savedMinor === 0 && s.spentMinor === 0) return null;

  const rate = s.incomeMinor > 0 ? Math.round((s.savedMinor / s.incomeMinor) * 100) : null;

  const spentParts = [
    s.committedMinor > 0 && `обязательное ${money(s.committedMinor)}`,
    s.occasionalMinor > 0 && `разовое ${money(s.occasionalMinor)}`,
    s.livingMinor > 0 && `жизнь ${money(s.livingMinor)}`,
  ].filter(Boolean) as string[];

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-xs uppercase tracking-widest text-ink-300">Пришло</h2>
        <p className="tnum text-lg font-medium whitespace-nowrap tabular-nums text-gain">
          {money(s.incomeMinor)} zł
        </p>
      </div>

      <div className="mt-6 grid gap-8 sm:grid-cols-3">
        <Column
          label="Отложено"
          amount={s.savedMinor}
          tone="gain"
          caption={rate === null ? null : `${rate}% от зарплаты`}
        />
        <Column
          label="Потрачено"
          amount={s.spentMinor}
          tone="muted"
          caption={spentParts.length > 0 ? spentParts.join(" · ") : null}
        />
        <Column
          label="Осталось"
          amount={s.leftMinor}
          tone="plain"
          caption={
            s.perDayLeftMinor !== null && s.daysRemaining > 0
              ? `${money(s.perDayLeftMinor)} zł в день · ${s.daysRemaining} дн.`
              : null
          }
        />
      </div>
    </section>
  );
}

const TONES = {
  gain: "text-gain",
  plain: "text-ink-100",
  muted: "text-ink-100",
} as const;

function Column({
  label,
  amount,
  tone,
  caption,
}: {
  label: string;
  amount: number;
  tone: keyof typeof TONES;
  caption: string | null;
}) {
  return (
    <div>
      <h3 className="text-xs uppercase tracking-widest text-ink-300">{label}</h3>
      <p
        className={`tnum mt-2 text-3xl leading-none font-semibold whitespace-nowrap tabular-nums sm:text-4xl ${TONES[tone]}`}
      >
        {money(amount)} <span className="text-xl sm:text-2xl">zł</span>
      </p>
      {caption && <p className="tnum mt-2 text-sm text-ink-300">{caption}</p>}
    </div>
  );
}
