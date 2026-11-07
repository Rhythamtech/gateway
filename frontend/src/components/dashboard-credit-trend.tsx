import * as React from "react"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import { listMyCreditHistory, type CreditHistoryPage } from "@/lib/auth"
import { formatCredits } from "@/lib/credits"
import { formatTimestampInDeviceZone, parseApiTimestamp } from "@/lib/datetime"

const HISTORY_LIMIT = 30
const dateLabel = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})
const compact = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumSignificantDigits: 3,
})

export function DashboardCreditTrend({ refreshTick }: { refreshTick: number }) {
  const [result, setResult] = React.useState<{
    tick: number
    history?: CreditHistoryPage
  }>()
  const current = result?.tick === refreshTick ? result : undefined

  React.useEffect(() => {
    let active = true
    void listMyCreditHistory({ pageSize: HISTORY_LIMIT }).then(
      (history) => {
        if (active) setResult({ tick: refreshTick, history })
      },
      () => {
        if (active) setResult({ tick: refreshTick })
      }
    )
    return () => {
      active = false
    }
  }, [refreshTick])

  const entries = (current?.history?.items ?? []).toReversed().map((entry) => ({
    timestamp: entry.created_at,
    credits: Number(entry.remaining_credits),
    exactCredits: entry.remaining_credits,
  }))

  return (
    <section
      className="min-w-0 rounded-xl border bg-card p-4 sm:p-6"
      aria-busy={!current}
    >
      <h3 className="font-semibold">Remaining credit history</h3>
      <p className="mt-1 mb-6 text-xs text-muted-foreground">
        Balance after each of the latest {HISTORY_LIMIT} ledger entries · Across
        all keys and dates
      </p>
      {!current ? (
        <Skeleton className="h-52 w-full" />
      ) : entries.length ? (
        <ChartContainer
          className="aspect-auto h-52 w-full"
          config={{
            credits: {
              label: "Remaining credits",
              color: "var(--analytics-credits)",
            },
          }}
        >
          <LineChart accessibilityLayer data={entries} margin={{ right: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="timestamp"
              axisLine={false}
              tickLine={false}
              minTickGap={24}
              tickFormatter={(value: string) => {
                const date = parseApiTimestamp(value)
                return date ? dateLabel.format(date) : value
              }}
            />
            <YAxis
              width={50}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value: number) => compact.format(value)}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(label) => {
                    const date =
                      typeof label === "string"
                        ? parseApiTimestamp(label)
                        : null
                    return date ? formatTimestampInDeviceZone(date) : label
                  }}
                  formatter={(_, __, item) => (
                    <span>
                      {formatCredits(item.payload.exactCredits)} credits
                    </span>
                  )}
                />
              }
            />
            <Line
              dataKey="credits"
              type="stepAfter"
              stroke="var(--color-credits)"
              strokeWidth={2}
              dot={entries.length === 1}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      ) : (
        <p className="grid h-52 place-items-center text-center text-sm text-muted-foreground">
          {current.history
            ? "No credit ledger entries yet."
            : "Credit history could not be loaded. Use Refresh to try again."}
        </p>
      )}
    </section>
  )
}
