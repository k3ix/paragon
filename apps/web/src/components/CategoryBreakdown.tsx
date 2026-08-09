import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import type { CategorySlice } from "@paragon/shared";
import { money } from "../lib/format";
import { useUntabbableChart } from "../lib/useUntabbableChart";

const RAMP = [
  "var(--color-slice-1)",
  "var(--color-slice-2)",
  "var(--color-slice-3)",
  "var(--color-slice-4)",
  "var(--color-slice-5)",
  "var(--color-slice-6)",
];

export function CategoryBreakdown({ slices }: { slices: CategorySlice[] }) {
  const chartRef = useUntabbableChart<HTMLDivElement>();
  if (slices.length === 0) {
    return (
      <section className="border-t border-ink-700 pt-6">
        <h2 className="text-xs uppercase tracking-widest text-ink-300">Where it went</h2>
        <p className="mt-4 text-sm text-ink-300">No spending recorded this month.</p>
      </section>
    );
  }

  const total = slices.reduce((sum, s) => sum + s.totalMinor, 0);

  return (
    <section className="border-t border-ink-700 pt-6">
      <h2 className="text-xs uppercase tracking-widest text-ink-300">Where it went</h2>

      <div className="mt-5 grid gap-8 md:grid-cols-[200px_1fr]">
        <div className="relative h-[200px]" ref={chartRef}>
          {/*
           * The chart itself is decorative — every figure it encodes is listed as text
           * beside it — so it stays out of the tab order. The total in the middle is
           * not decorative and remains readable.
           */}
          <ResponsiveContainer width="100%" height="100%" aria-hidden="true">
            <PieChart accessibilityLayer={false}>
              <Pie
                data={slices}
                dataKey="totalMinor"
                innerRadius={62}
                outerRadius={88}
                startAngle={90}
                endAngle={-270}
                stroke="none"
                isAnimationActive={false}
              >
                {slices.map((slice, index) => (
                  <Cell key={slice.categoryId ?? "none"} fill={RAMP[index % RAMP.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="tnum text-lg font-medium">{money(total)}</span>
            <span className="text-xs text-ink-300">PLN</span>
          </div>
        </div>

        <ul>
          {slices.map((slice, index) => (
            <li
              key={slice.categoryId ?? "none"}
              className="flex items-center justify-between border-b border-ink-700 py-2 last:border-0"
            >
              <span className="flex items-center gap-2 text-sm">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: RAMP[index % RAMP.length] }}
                />
                {slice.name}
              </span>
              <span className="tnum text-sm">
                {money(slice.totalMinor)}
                <span className="ml-3 text-ink-300">{slice.share}%</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
