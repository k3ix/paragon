import { Line, LineChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import type { TrendPoint } from "@paragon/shared";
import { money } from "../lib/format";
import { useUntabbableChart } from "../lib/useUntabbableChart";

export function TrendChart({ trend }: { trend: TrendPoint[] }) {
  const chartRef = useUntabbableChart<HTMLDivElement>();
  const data = trend.map((p) => {
    const [year, month] = p.month.split("-");
    return {
      // January carries its year so a twelve-month span shows where it turned over.
      month: month === "01" ? `01·${year!.slice(2)}` : month!,
      income: p.incomeMinor / 100,
      spent: p.spentMinor / 100,
    };
  });

  return (
    <section className="border-t border-ink-700 pt-6">
      <h2 className="text-xs uppercase tracking-widest text-ink-300">Income and spending</h2>

      <div className="mt-5 h-[180px]" aria-hidden="true" ref={chartRef}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
            accessibilityLayer={false}
          >
            <XAxis
              dataKey="month"
              tick={{ fill: "var(--color-ink-300)", fontSize: 11 }}
              axisLine={{ stroke: "var(--color-ink-700)" }}
              tickLine={false}
            />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                background: "var(--color-ink-800)",
                border: "1px solid var(--color-ink-700)",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--color-ink-300)" }}
              // Recharts types the value as ValueType | undefined; the chart only ever
              // feeds it the numbers built above, so anything else renders as a dash.
              formatter={(value) =>
                typeof value === "number" ? money(Math.round(value * 100)) : "—"
              }
            />
            <Line
              type="monotone"
              dataKey="income"
              stroke="var(--color-gain)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="spent"
              stroke="var(--color-drain)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-3 flex gap-5 text-xs text-ink-300">
        <span className="flex items-center gap-2">
          <span className="inline-block h-px w-4 bg-gain" /> income
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-px w-4 bg-drain" /> spent
        </span>
      </p>
    </section>
  );
}
