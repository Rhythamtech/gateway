import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  getApiKeyUsage,
  getGatewayModelUsage,
  getUserUsage,
  type DailyUsageEntry,
  type UsageAnalytics,
  type UsageRange,
} from "@/lib/auth"
import { Button } from "@/components/ui/button"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export type UsageSubject =
  | { kind: "api_key"; id: string; label: string }
  | { kind: "gateway_model"; id: string; label: string }
  | { kind: "user"; id: string; label: string }

type UsageAnalyticsDrawerProps = {
  subject: UsageSubject
  /** Shown when the viewer's totals aggregate beyond their own rows. */
  scopeNote?: string
  onClose: () => void
}

type RangeValue = "all" | "7d" | "30d" | "90d"

const CHART_CONFIG = {
  calls: {
    label: "Attempts",
    color: "var(--primary)",
  },
} satisfies ChartConfig

function formatInt(value: number | null) {
  return (value ?? 0).toLocaleString("en-US")
}

function formatMs(value: number | null) {
  if (value === null) return "—"
  if (value < 1_000) return `${formatInt(value)} ms`
  const seconds = value / 1_000
  if (seconds < 60)
    return `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)} s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  if (minutes < 60) return `${minutes}m ${rest}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

// Inclusive date bounds (UTC) for a preset window; "all" omits both and lets
// the backend apply its default window (subject creation through today).
function resolveRange(range: RangeValue): UsageRange {
  if (range === "all") return {}
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90
  const today = new Date()
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - (days - 1))
  return {
    from: start.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  }
}

function fetchUsage(subject: UsageSubject, range: UsageRange) {
  if (subject.kind === "api_key") return getApiKeyUsage(subject.id, range)
  if (subject.kind === "gateway_model")
    return getGatewayModelUsage(subject.id, range)
  return getUserUsage(subject.id, range)
}

const DAILY_COLUMNS: {
  key: Exclude<keyof DailyUsageEntry, "date">
  label: string
  format: (value: number | null) => string
}[] = [
  { key: "call_count", label: "Attempts", format: formatInt },
  { key: "failed_call_count", label: "Failed", format: formatInt },
  { key: "input_tokens", label: "Input", format: formatInt },
  { key: "output_tokens", label: "Output", format: formatInt },
  { key: "cache_tokens", label: "Cache", format: formatInt },
  { key: "average_latency_ms", label: "Avg latency", format: formatMs },
]

export function UsageAnalyticsDrawer({
  subject,
  scopeNote,
  onClose,
}: UsageAnalyticsDrawerProps) {
  const isMobile = useIsMobile()
  const [range, setRange] = React.useState<RangeValue>("all")
  const [analytics, setAnalytics] = React.useState<UsageAnalytics | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [reloadTick, setReloadTick] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false

    fetchUsage(subject, resolveRange(range))
      .then((result) => {
        if (cancelled) return
        setAnalytics(result)
        setError(null)
      })
      .catch((requestError: unknown) => {
        if (cancelled) return
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load usage."
        )
      })

    return () => {
      cancelled = true
    }
  }, [subject, range, reloadTick])

  function refresh() {
    setReloadTick((tick) => tick + 1)
  }

  const chartData =
    analytics?.daily.map((entry) => ({
      date: entry.date,
      calls: entry.call_count,
    })) ?? []

  return (
    <Drawer
      direction={isMobile ? "bottom" : "right"}
      open={true}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DrawerContent>
        <DrawerHeader className="shrink-0 gap-1 border-b">
          <DrawerTitle>Usage — {subject.label}</DrawerTitle>
          <DrawerDescription>
            Operational usage of actual attempts, including retries — not
            billing.{" "}
            {analytics
              ? `${analytics.from_date} – ${analytics.to_date} (UTC)`
              : null}
            {scopeNote ? ` ${scopeNote}` : ""}
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-2 text-sm">
          {error !== null && analytics === null ? (
            <p className="text-sm text-destructive" role="alert">
              {error}{" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={refresh}
              >
                Try again
              </button>
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <label
              htmlFor="usage-window"
              className="text-xs font-medium text-muted-foreground"
            >
              Window
            </label>
            <Select
              value={range}
              onValueChange={(value) => setRange(value as RangeValue)}
            >
              <SelectTrigger
                id="usage-window"
                className="w-full sm:w-44"
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error !== null && analytics !== null ? (
            <p className="text-sm text-destructive" role="alert">
              {error}{" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={refresh}
              >
                Try again
              </button>
            </p>
          ) : null}

          {analytics === null && error === null ? (
            <p className="py-8 text-center text-muted-foreground">
              Loading usage…
            </p>
          ) : analytics ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <TotalsBlock
                  label="Attempts"
                  value={formatInt(analytics.totals.call_count)}
                />
                <TotalsBlock
                  label="Successful"
                  value={formatInt(analytics.totals.successful_call_count)}
                />
                <TotalsBlock
                  label="Failed"
                  value={formatInt(analytics.totals.failed_call_count)}
                />
                <TotalsBlock
                  label="Input tokens"
                  value={formatInt(analytics.totals.input_tokens)}
                />
                <TotalsBlock
                  label="Output tokens"
                  value={formatInt(analytics.totals.output_tokens)}
                />
                <TotalsBlock
                  label="Cache tokens"
                  value={formatInt(analytics.totals.cache_tokens)}
                />
                <TotalsBlock
                  label="Total latency"
                  value={formatMs(analytics.totals.total_latency_ms)}
                />
                <TotalsBlock
                  label="Average latency"
                  value={formatMs(analytics.totals.average_latency_ms)}
                />
              </div>

              {chartData.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Daily attempts
                  </p>
                  <ChartContainer
                    config={CHART_CONFIG}
                    className="aspect-auto h-[200px] w-full"
                  >
                    <AreaChart
                      data={chartData}
                      margin={{ left: -12, right: 4 }}
                    >
                      <defs>
                        <linearGradient
                          id="fillUsageCalls"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="var(--color-calls)"
                            stopOpacity={1.0}
                          />
                          <stop
                            offset="95%"
                            stopColor="var(--color-calls)"
                            stopOpacity={0.1}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={32}
                      />
                      <YAxis tickLine={false} axisLine={false} width={44} />
                      <ChartTooltip
                        cursor={false}
                        content={<ChartTooltipContent indicator="dot" />}
                      />
                      <Area
                        dataKey="calls"
                        type="monotone"
                        fill="url(#fillUsageCalls)"
                        stroke="var(--color-calls)"
                      />
                    </AreaChart>
                  </ChartContainer>
                </div>
              ) : (
                <p className="py-4 text-center text-muted-foreground">
                  No usage recorded in this window.
                </p>
              )}

              {analytics.daily.length > 0 ? (
                <div className="overflow-hidden rounded-lg border">
                  <Table>
                    <TableHeader className="bg-muted">
                      <TableRow>
                        <TableHead>Date</TableHead>
                        {DAILY_COLUMNS.map((column) => (
                          <TableHead key={column.key} className="text-right">
                            {column.label}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analytics.daily.map((entry) => (
                        <TableRow key={entry.date}>
                          <TableCell className="font-mono text-xs">
                            {entry.date}
                          </TableCell>
                          {DAILY_COLUMNS.map((column) => (
                            <TableCell
                              key={column.key}
                              className="text-right font-mono text-xs tabular-nums"
                            >
                              {column.format(entry[column.key])}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        <DrawerFooter
          className="shrink-0 border-t"
          style={{
            paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
          }}
        >
          <DrawerClose asChild>
            <Button type="button" variant="outline">
              Close
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

function TotalsBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-muted p-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-sm tabular-nums">{value}</span>
    </div>
  )
}
