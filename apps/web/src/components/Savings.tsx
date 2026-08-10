import { money } from "../lib/format";

type Summary = {
  incomeMinor: number;
  savedMinor: number;
  spentMinor: number;
  leftMinor: number;
  daysRemaining: number;
  perDayLeftMinor: number | null;
};

/**
 * The two figures a household actually operates on: what was put away, and what is
 * left to live on until the next paycheque.
 *
 * Side by side rather than stacked — they are the answer to one question ("how did we
 * split this salary"), and stacking them buried both in a column of similar-looking
 * text. Balances and returns live in the broker's app and the bank's; the only thing
 * needed here is how much was moved out.
 */
export function Savings({ summary }: { summary: Summary }) {
  const s = summary;
  if (s.incomeMinor === 0 && s.savedMinor === 0) return null;

  const rate = s.incomeMinor > 0 ? Math.round((s.savedMinor / s.incomeMinor) * 100) : null;

  return (
    <section>
      <div className="grid gap-8 sm:grid-cols-2">
        <Headline
          label="Отложено"
          amount={s.savedMinor}
          tone="gain"
          caption={rate === null ? null : `${rate}% от зарплаты`}
        />
        <Headline
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

      {/*
       * Three different events, so three different marks: salary arrives, savings
       * move to an account you still own, spending is gone. A transfer rendered as a
       * grey minus filed it under "money lost", which is the opposite of what it is.
       */}
      <dl className="mt-8 flex flex-wrap gap-x-8 gap-y-2 border-t border-ink-700 pt-4 text-sm">
        <Row label="Пришло" value={`+${money(s.incomeMinor)}`} tone="gain" />
        <Row label="Отложено" value={`→ ${money(s.savedMinor)}`} tone="moved" />
        <Row label="Потрачено" value={`−${money(s.spentMinor)}`} tone="spent" />
      </dl>
    </section>
  );
}

function Headline({
  label,
  amount,
  tone,
  caption,
}: {
  label: string;
  amount: number;
  tone: "gain" | "plain";
  caption: string | null;
}) {
  return (
    <div>
      <h2 className="text-xs uppercase tracking-widest text-ink-300">{label}</h2>
      <p
        className={`tnum mt-2 text-4xl leading-none font-semibold whitespace-nowrap sm:text-5xl ${
          tone === "gain" ? "text-gain" : "text-ink-100"
        }`}
      >
        {money(amount)} zł
      </p>
      {caption && <p className="tnum mt-2 text-sm text-ink-300">{caption}</p>}
    </div>
  );
}

const TONES = {
  gain: "text-gain",
  // Savings keep the full-strength colour: the money is still yours, just elsewhere.
  moved: "text-ink-100",
  spent: "text-ink-300",
} as const;

function Row({ label, value, tone }: { label: string; value: string; tone: keyof typeof TONES }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-ink-300">{label}</dt>
      <dd className={`tnum whitespace-nowrap tabular-nums ${TONES[tone]}`}>{value}</dd>
    </div>
  );
}
