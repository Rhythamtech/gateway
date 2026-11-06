import { Line, LineChart, YAxis } from "recharts"
import { ChartContainer } from "@/components/ui/chart"

/** Decorative summary of the same reported daily values exposed in the data table. */
export function DashboardMetricTrend({
  values,
  color,
  percentage = false,
}: {
  values: (number | null)[]
  color: string
  percentage?: boolean
}) {
  if (!values.some((value) => value !== null)) {
    return (
      <div aria-hidden="true" className="flex h-12 items-center">
        <div className="w-full border-t border-dashed" />
      </div>
    )
  }
  return (
    <ChartContainer
      aria-hidden="true"
      className="aspect-auto h-12 w-full"
      config={{ value: { color } }}
    >
      <LineChart
        data={values.map((value) => ({ value }))}
        margin={{ top: 6, bottom: 6, left: 3, right: 3 }}
        accessibilityLayer={false}
      >
        <YAxis hide domain={percentage ? [0, 100] : [0, "auto"]} />
        <Line
          dataKey="value"
          stroke="var(--color-value)"
          strokeWidth={1.75}
          dot={
            values.filter((value) => value !== null).length === 1
              ? { r: 3, fill: color, strokeWidth: 0 }
              : false
          }
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  )
}
