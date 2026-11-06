import * as React from "react"
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  CalendarDays,
  KeyRound,
  Layers,
  RefreshCw,
  Timer,
} from "lucide-react"
import {
  getApiKeyUsage,
  getUserUsage,
  getMyUsage,
  getMyCredits,
  listApiKeys,
  type ApiKeyItem,
  type UsageAnalytics,
  type UsageTotals,
  type CreditBalance,
  type CurrentUser,
} from "@/lib/auth"
import { formatCredits } from "@/lib/credits"
import { formatTimestampInDeviceZone, parseApiTimestamp } from "@/lib/datetime"
import { DashboardMetricTrend } from "@/components/dashboard-metric-trend"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectGroup,
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
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts"

const DashboardRecentCharges = React.lazy(
  () => import("@/components/dashboard-recent-charges")
)
const DashboardDailyUsage = React.lazy(
  () => import("@/components/dashboard-daily-usage")
)

const compact = (value: number) =>
  new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
const dateLabel = (value: string) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Never"
  const date = parseApiTimestamp(value)
  return date === null ? value : formatTimestampInDeviceZone(date)
}

export function DashboardOverview({ user }: { user: CurrentUser }) {
  const [keys, setKeys] = React.useState<ApiKeyItem[]>([])
  const [keyError, setKeyError] = React.useState<string | null>(null)
  const [keysLoaded, setKeysLoaded] = React.useState(false)
  const [subject, setSubject] = React.useState("account")
  const [period, setPeriod] = React.useState("30")
  const [customRange, setCustomRange] = React.useState(() => {
    const end = new Date()
    const start = new Date(end)
    start.setUTCDate(start.getUTCDate() - 29)
    return {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    }
  })
  const [draftFrom, setDraftFrom] = React.useState(customRange.from)
  const [draftTo, setDraftTo] = React.useState(customRange.to)
  const [rangeError, setRangeError] = React.useState<string | null>(null)
  const [tick, setTick] = React.useState(0)
  const [balance, setBalance] = React.useState<CreditBalance | null>(null)
  const [balanceError, setBalanceError] = React.useState(false)
  const [result, setResult] = React.useState<{
    key: string
    scope: string
    data: UsageAnalytics
    at: Date
  } | null>(null)
  const [failure, setFailure] = React.useState<{
    key: string
    message: string
  } | null>(null)
  const today = new Date().toISOString().slice(0, 10)
  const range = React.useMemo(() => {
    if (period === "custom") return customRange
    const end = new Date(`${today}T00:00:00Z`)
    const start = new Date(end)
    start.setUTCDate(start.getUTCDate() - Number(period) + 1)
    return {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    }
  }, [period, customRange, today])
  const scopeKey = `${subject}:${range.from}:${range.to}`
  const requestKey = `${scopeKey}:${tick}`
  function applyCustomRange(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    const validDate = (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
      const date = new Date(`${value}T00:00:00Z`)
      return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
      )
    }
    if (!validDate(draftFrom) || !validDate(draftTo)) {
      setRangeError("Enter valid start and end dates.")
      return
    }
    if (draftFrom > draftTo) {
      setRangeError("The start date must be on or before the end date.")
      return
    }
    if (draftTo > new Date().toISOString().slice(0, 10)) {
      setRangeError("The end date cannot be in the future (UTC).")
      return
    }
    setRangeError(null)
    setCustomRange({ from: draftFrom, to: draftTo })
  }
  const data = result?.scope === scopeKey ? result.data : null
  const error = failure?.key === requestKey ? failure.message : null
  const loading = Boolean(subject && result?.key !== requestKey && !error)
  const initialLoading = loading && !data
  const hasDraftDates =
    period === "custom" &&
    (draftFrom !== customRange.from || draftTo !== customRange.to)
  React.useEffect(() => {
    let cancelled = false
    listApiKeys()
      .then((value) => {
        if (!cancelled) {
          setKeys(value.items)
          setKeyError(null)
          setKeysLoaded(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setKeyError("API keys could not be loaded.")
          setKeysLoaded(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [tick])
  React.useEffect(() => {
    let cancelled = false
    getMyCredits()
      .then((value) => {
        if (!cancelled) {
          setBalance(value)
          setBalanceError(false)
        }
      })
      .catch(() => {
        if (!cancelled) setBalanceError(true)
      })
    return () => {
      cancelled = true
    }
  }, [tick])
  React.useEffect(() => {
    if (!subject) return
    let cancelled = false
    const request =
      subject === "account"
        ? user.role === "superuser"
          ? getUserUsage(user.id, range, true)
          : getMyUsage(range, true)
        : getApiKeyUsage(subject, range, true)
    request
      .then((value) => {
        if (!cancelled)
          setResult({
            key: requestKey,
            scope: scopeKey,
            data: value,
            at: new Date(),
          })
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setFailure({
            key: requestKey,
            message:
              reason instanceof Error
                ? reason.message
                : "Analytics could not be loaded.",
          })
      })
    return () => {
      cancelled = true
    }
  }, [subject, range, requestKey, scopeKey, user.id, user.role])
  const totals = data?.totals
  const daily = data?.daily ?? []
  const hourly = data?.hourly?.map((bucket) => ({
    ...bucket,
    label: `${String(bucket.hour).padStart(2, "0")}:00`,
  }))
  const metrics = [
    {
      label: "Traced calls",
      value: totals?.call_count.toLocaleString(),
      note: "Recorded provider attempts",
      icon: Activity,
      color: "var(--analytics-volume)",
      trend: daily.map((day) => day.call_count),
      percentage: false,
    },
    {
      label: "Reported tokens",
      value: totals
        ? compact(totals.input_tokens + totals.output_tokens)
        : undefined,
      note: "Input + output tokens",
      icon: Layers,
      color: "var(--analytics-tokens)",
      trend: daily.map((day) => day.input_tokens + day.output_tokens),
      percentage: false,
    },
    {
      label: "Call success rate",
      value:
        totals && totals.call_count
          ? `${((totals.successful_call_count / totals.call_count) * 100).toFixed(1)}%`
          : "—",
      note: "Successful / recorded calls",
      icon: CheckCircle2,
      color: "var(--analytics-success)",
      trend: daily.map((day) =>
        day.call_count
          ? (day.successful_call_count / day.call_count) * 100
          : null
      ),
      percentage: true,
    },
    {
      label: "Average call latency",
      value:
        totals?.average_latency_ms != null
          ? `${(totals.average_latency_ms / 1000).toFixed(2)} s`
          : "—",
      note: "Sample-weighted average",
      icon: Timer,
      color: "var(--analytics-latency)",
      trend: daily.map((day) => day.average_latency_ms),
      percentage: false,
    },
  ]
  const chartEmpty = !data || !totals?.call_count
  const empty = (
    <ChartPlaceholder
      loading={initialLoading || (!keysLoaded && !subject)}
      error={Boolean(error)}
      hasScope={Boolean(subject)}
      tracingEnabled={user.tracing_enabled}
    />
  )
  const selectedKey = keys.find((k) => k.id === subject)
  const isAccountScope = subject === "account"

  return (
    <div className="dashboard-analytics @container/analytics flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Activity overview
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {user.role === "superuser"
              ? "My Usage across your account."
              : "My Usage across your account, with an optional API key filter."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <a href="/dashboard/api-keys">
              <KeyRound data-icon="inline-start" /> Manage API keys
            </a>
          </Button>
          <Button asChild size="sm">
            <a href="/dashboard/playground">
              Open Playground <ArrowUpRight data-icon="inline-end" />
            </a>
          </Button>
        </div>
      </div>
      <section
        id="dashboard-reporting"
        aria-label="Reporting controls"
        className="flex scroll-mt-4 flex-wrap items-end justify-between gap-4 rounded-xl border bg-muted/20 p-4"
      >
        <div className="flex min-w-0 flex-wrap gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <label
              htmlFor="analytics-scope"
              className="text-xs font-medium text-muted-foreground"
            >
              Reporting scope
            </label>
            <Select value={subject} onValueChange={setSubject}>
              <SelectTrigger
                id="analytics-scope"
                className="w-full max-w-72 min-w-48"
              >
                <SelectValue placeholder="Select an API key" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="account">My account (all keys)</SelectItem>
                  {keys.map((key) => (
                    <SelectItem key={key.id} value={key.id}>
                      {key.name || key.key_prefix}
                      {key.revoked ? " (revoked)" : ""}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <span
              id="analytics-period-label"
              className="text-xs font-medium text-muted-foreground"
            >
              Reporting period · UTC
            </span>
            <ToggleGroup
              type="single"
              value={period}
              onValueChange={(value) => {
                if (value) {
                  setPeriod(value)
                  setRangeError(null)
                }
              }}
              variant="outline"
              size="sm"
              aria-labelledby="analytics-period-label"
            >
              {["7", "30", "90"].map((days) => (
                <ToggleGroupItem
                  key={days}
                  value={days}
                  aria-label={`Last ${days} days`}
                >
                  {days} days
                </ToggleGroupItem>
              ))}
              <ToggleGroupItem value="custom">
                <CalendarDays className="size-3.5" />
                Custom
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground" role="status">
            {loading
              ? "Loading analytics…"
              : data && result
                ? `Updated ${result.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : ""}
          </span>
          <Button
            variant="outline"
            size="sm"
            aria-label="Refresh analytics and balance"
            disabled={loading}
            onClick={() => setTick((value) => value + 1)}
          >
            <RefreshCw
              data-icon="inline-start"
              className={loading ? "motion-safe:animate-spin" : undefined}
            />
            Refresh
          </Button>
        </div>
      </section>
      {period === "custom" && (
        <form
          onSubmit={applyCustomRange}
          noValidate
          className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-4"
          aria-label="Custom reporting period"
        >
          <Field
            className="w-full gap-2 sm:w-auto"
            data-invalid={Boolean(rangeError)}
          >
            <FieldLabel htmlFor="analytics-from">From date · UTC</FieldLabel>
            <Input
              id="analytics-from"
              type="date"
              value={draftFrom}
              onChange={(event) => {
                setDraftFrom(event.target.value)
                setRangeError(null)
              }}
              max={draftTo || new Date().toISOString().slice(0, 10)}
              aria-invalid={Boolean(rangeError)}
              aria-describedby="analytics-range-error"
            />
          </Field>
          <Field
            className="w-full gap-2 sm:w-auto"
            data-invalid={Boolean(rangeError)}
          >
            <FieldLabel htmlFor="analytics-to">To date · UTC</FieldLabel>
            <Input
              id="analytics-to"
              type="date"
              value={draftTo}
              onChange={(event) => {
                setDraftTo(event.target.value)
                setRangeError(null)
              }}
              min={draftFrom}
              max={new Date().toISOString().slice(0, 10)}
              aria-invalid={Boolean(rangeError)}
              aria-describedby="analytics-range-error"
            />
          </Field>
          <Button type="submit" disabled={!hasDraftDates}>
            Apply dates
          </Button>
          {hasDraftDates && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraftFrom(customRange.from)
                setDraftTo(customRange.to)
                setRangeError(null)
              }}
            >
              Discard changes
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            {hasDraftDates ? "Date changes are not applied. " : ""}Showing{" "}
            {range.from} through {range.to}, inclusive.
          </p>
          <p
            id="analytics-range-error"
            role={rangeError ? "alert" : undefined}
            className={
              rangeError ? "w-full text-xs text-destructive" : "sr-only"
            }
          >
            {rangeError ?? ""}
          </p>
        </form>
      )}
      {(error || keyError) && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-4 text-sm"
        >
          <p>
            {error || keyError}
            {error && data
              ? " Showing the last successful analytics for this scope and period."
              : ""}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTick((value) => value + 1)}
          >
            Try again
          </Button>
        </div>
      )}
      {!subject && keysLoaded && !keyError && (
        <div className="rounded-xl border p-6">
          <h3 className="font-medium">Choose a key to explore usage</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Create an API key, then record traffic to see its analytics.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <a href="/dashboard/api-keys">Manage API keys</a>
          </Button>
        </div>
      )}
      {selectedKey ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 font-semibold text-foreground">
              <KeyRound className="size-3.5 text-primary" />
              {selectedKey.name || "Untitled key"}
            </span>
            <span className="font-mono text-muted-foreground">
              {selectedKey.key_prefix}…
            </span>
            <Badge
              variant={selectedKey.revoked ? "destructive" : "outline"}
              className="px-1.5 py-0 text-[10px]"
            >
              {selectedKey.revoked ? "Revoked" : "Active"}
            </Badge>
          </div>
          <span className="text-muted-foreground">
            Last used: {formatDateTime(selectedKey.last_used_at)}
          </span>
        </div>
      ) : isAccountScope ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <Activity className="size-3.5 text-primary" />
          <span>
            My account · all recorded API-key traffic. This is not gateway-wide
            usage.
          </span>
        </div>
      ) : null}
      <div
        aria-label="Usage summary"
        aria-busy={loading}
        className="grid grid-cols-2 gap-3 sm:gap-4 @min-[900px]/analytics:grid-cols-4"
      >
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="flex min-w-0 flex-col gap-2 overflow-hidden rounded-xl border bg-card p-4 sm:p-5"
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <metric.icon
                className="hidden size-4 sm:block"
                style={{ color: metric.color }}
              />
              {metric.label}
            </div>
            {initialLoading ? (
              <Skeleton className="h-9 w-24" />
            ) : (
              <p className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
                {data ? metric.value : "—"}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{metric.note}</p>
            {initialLoading ? (
              <Skeleton className="mt-2 h-12 w-full" />
            ) : (
              <DashboardMetricTrend
                values={metric.trend}
                color={metric.color}
                percentage={metric.percentage}
              />
            )}
            <span className="sr-only">
              Sparkline summarizes the selected period; exact daily values are
              available in View daily data.
            </span>
          </div>
        ))}
      </div>
      {!error && !keyError && !user.tracing_enabled && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3 text-xs text-muted-foreground">
          <p>
            Tracing is off for your account. Historical analytics remain
            available; new requests will not appear here.
          </p>
          <Button asChild variant="link" size="sm">
            <a href="/dashboard/settings">
              Review tracing settings
              <ArrowUpRight data-icon="inline-end" />
            </a>
          </Button>
        </div>
      )}
      {!error &&
        !keyError &&
        user.tracing_enabled &&
        totals &&
        totals.failed_call_count > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 px-4 py-3 text-xs">
            <p>
              <span className="font-medium tabular-nums">
                {totals.failed_call_count.toLocaleString()} unsuccessful calls
              </span>
              <span className="text-muted-foreground">
                {" "}
                in this period
                {totals.call_count
                  ? ` (${((totals.failed_call_count / totals.call_count) * 100).toFixed(1)}% of recorded calls)`
                  : ""}
                .
              </span>
            </p>
            {user.role === "superuser" && (
              <Button asChild variant="link" size="sm">
                <a href="/dashboard/traces">
                  Investigate traces
                  <ArrowUpRight data-icon="inline-end" />
                </a>
              </Button>
            )}
          </div>
        )}
      <div className="grid min-w-0 gap-6 @min-[900px]/analytics:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section
          aria-label="Call activity chart"
          aria-busy={loading}
          className="min-w-0 rounded-xl border bg-card p-4 sm:p-6"
        >
          <div className="mb-6 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold">Call activity</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Completed attempts by UTC hour of day, combined across this
                period.
              </p>
            </div>
            <span className="text-xs text-muted-foreground">
              {data
                ? `${dateLabel(data.from_date)} – ${dateLabel(data.to_date)}`
                : `${dateLabel(range.from)} – ${dateLabel(range.to)}`}{" "}
              · UTC
            </span>
          </div>
          {!data ? (
            empty
          ) : !hourly?.length ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Hourly activity is unavailable.
            </p>
          ) : (
            <ChartContainer
              className="aspect-auto h-64 w-full sm:h-72"
              config={{
                successful_call_count: {
                  label: "Successful",
                  color: "var(--analytics-volume)",
                },
                failed_call_count: {
                  label: "Unsuccessful",
                  color: "var(--destructive)",
                },
              }}
            >
              <BarChart
                accessibilityLayer
                data={hourly}
                margin={{ left: 0, right: 8 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  minTickGap={32}
                />
                <YAxis
                  width={36}
                  allowDecimals={false}
                  tickFormatter={compact}
                  axisLine={false}
                  tickLine={false}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar
                  dataKey="successful_call_count"
                  stackId="calls"
                  fill="var(--color-successful_call_count)"
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="failed_call_count"
                  stackId="calls"
                  fill="var(--color-failed_call_count)"
                  isAnimationActive={false}
                />
                <ChartLegend content={<ChartLegendContent />} />
              </BarChart>
            </ChartContainer>
          )}
        </section>
        <CallOutcomes totals={totals} loading={initialLoading} />
      </div>
      {!chartEmpty && (
        <div className="grid min-w-0 gap-6 @min-[760px]/analytics:grid-cols-2">
          <section className="min-w-0 rounded-xl border p-4 sm:p-6">
            <h3 className="font-semibold">Token volume</h3>
            <p className="mt-1 mb-6 text-xs text-muted-foreground">
              Provider-reported input and output tokens
            </p>
            {chartEmpty ? (
              empty
            ) : (
              <ChartContainer
                className="aspect-auto h-52 w-full"
                config={{
                  input_tokens: {
                    label: "Input",
                    color: "var(--analytics-tokens)",
                  },
                  output_tokens: {
                    label: "Output",
                    color: "var(--analytics-output)",
                  },
                }}
              >
                <BarChart accessibilityLayer data={daily}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={dateLabel}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={32}
                  />
                  <YAxis
                    width={40}
                    tickFormatter={compact}
                    axisLine={false}
                    tickLine={false}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="input_tokens"
                    stackId="tokens"
                    fill="var(--color-input_tokens)"
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="output_tokens"
                    stackId="tokens"
                    fill="var(--color-output_tokens)"
                    radius={[3, 3, 0, 0]}
                    isAnimationActive={false}
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                </BarChart>
              </ChartContainer>
            )}
          </section>
          <section className="min-w-0 rounded-xl border p-4 sm:p-6">
            <h3 className="font-semibold">Latency trend</h3>
            <p className="mt-1 mb-6 text-xs text-muted-foreground">
              Daily average call latency · milliseconds
            </p>
            {chartEmpty ? (
              empty
            ) : (
              <ChartContainer
                className="aspect-auto h-52 w-full"
                config={{
                  average_latency_ms: {
                    label: "Average latency (ms)",
                    color: "var(--analytics-latency)",
                  },
                }}
              >
                <LineChart accessibilityLayer data={daily}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={dateLabel}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={32}
                  />
                  <YAxis
                    width={40}
                    tickFormatter={compact}
                    axisLine={false}
                    tickLine={false}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line
                    dataKey="average_latency_ms"
                    type="monotone"
                    stroke="var(--color-average_latency_ms)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ChartContainer>
            )}
          </section>
        </div>
      )}
      <div className="grid min-w-0 items-start gap-6 @min-[1100px]/analytics:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <React.Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <DashboardDailyUsage
            key={scopeKey}
            daily={daily}
            from={range.from}
            to={range.to}
            loading={initialLoading}
            unavailable={Boolean(error && !data) || !subject}
            scopeLabel={
              isAccountScope
                ? "My account"
                : selectedKey?.name ||
                  selectedKey?.key_prefix ||
                  "Selected API key"
            }
          />
        </React.Suspense>
        <React.Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <DashboardRecentCharges refreshTick={tick} />
        </React.Suspense>
      </div>
      <details className="group rounded-xl border">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-6">
          <span className="flex items-center gap-2 text-sm font-medium">
            <KeyRound className="size-4" />
            API key directory
            <span className="text-xs font-normal text-muted-foreground">
              {keysLoaded ? keys.length : "…"} keys
            </span>
          </span>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <Card className="rounded-t-none border-0 border-t shadow-none">
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="size-4 text-primary" />
                <span>Key activity</span>
              </CardTitle>
              <CardDescription>
                Choose a key to show its analytics above. Manage credentials on
                the API Keys page.
              </CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <a href="/dashboard/api-keys">Manage in API Keys</a>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead className="pl-4">Key Name</TableHead>
                    <TableHead>Prefix</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead className="pr-4 text-right">Metrics</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="h-20 text-center text-xs text-muted-foreground"
                      >
                        No API keys found. Create an API key in API Keys to
                        start recording metrics.
                      </TableCell>
                    </TableRow>
                  ) : (
                    keys.map((key) => {
                      const isSelected = subject === key.id
                      return (
                        <TableRow
                          key={key.id}
                          className={
                            isSelected ? "bg-muted/40 font-medium" : undefined
                          }
                        >
                          <TableCell className="pl-4 font-medium">
                            {key.name || "Untitled key"}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {key.key_prefix}…
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={key.revoked ? "destructive" : "outline"}
                              className="px-1.5 py-0 text-[10px]"
                            >
                              {key.revoked ? "Revoked" : "Active"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                            {formatDateTime(key.created_at)}
                          </TableCell>
                          <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                            {formatDateTime(key.last_used_at)}
                          </TableCell>
                          <TableCell className="pr-4 text-right">
                            {isSelected ? (
                              <Badge
                                variant="secondary"
                                className="px-2 py-0.5 text-xs font-normal"
                              >
                                Viewing
                              </Badge>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => {
                                  setSubject(key.id)
                                  window.scrollTo({
                                    top: 0,
                                    behavior: "smooth",
                                  })
                                }}
                              >
                                View metrics
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </details>
      <footer className="flex flex-wrap items-center justify-between gap-4 border-t pt-5">
        <p className="max-w-xl text-xs leading-5 text-muted-foreground">
          Tracing is opt-in. These metrics cover recorded attempts only, not
          billing. Missing provider usage is not estimated.
          {!user.tracing_enabled
            ? " Tracing is currently off for your account."
            : ""}
        </p>
        <a
          href="/dashboard/credits"
          className="flex items-center gap-2 text-sm font-medium underline-offset-4 hover:underline"
        >
          {balanceError
            ? "Balance unavailable"
            : balance
              ? `${formatCredits(balance.available_credits)} credits available`
              : "Loading balance…"}
          <ArrowUpRight className="size-4" />
        </a>
      </footer>
    </div>
  )
}
function ChartPlaceholder({
  loading,
  error,
  hasScope,
  tracingEnabled,
}: {
  loading: boolean
  error: boolean
  hasScope: boolean
  tracingEnabled: boolean
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg bg-muted/20 px-5 py-8 text-center">
      {loading ? (
        <>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-24 w-3/4" />
          <span role="status" className="text-xs text-muted-foreground">
            Loading recorded activity…
          </span>
        </>
      ) : (
        <>
          <div className="flex size-11 items-center justify-center rounded-xl border bg-background">
            <Activity className="size-5 text-muted-foreground" />
          </div>
          <h4 className="text-sm font-medium">
            {error
              ? "Activity could not be loaded"
              : !hasScope
                ? "Select an API key to begin"
                : "No recorded calls in this period"}
          </h4>
          <p className="max-w-sm text-xs leading-5 text-muted-foreground">
            {error
              ? "Use Try again above to reload this reporting scope."
              : !hasScope
                ? "Create a key or select an existing one in the reporting controls."
                : !tracingEnabled
                  ? "Try an earlier date range. Tracing is currently off, so new requests will not add analytics."
                  : "Choose a wider date range or run a request in the Playground."}
          </p>
          {!error && (
            <Button asChild variant="outline" size="sm">
              <a
                href={
                  !hasScope
                    ? "/dashboard/api-keys"
                    : !tracingEnabled
                      ? "/dashboard/settings"
                      : "/dashboard/playground"
                }
              >
                {!hasScope
                  ? "Manage API keys"
                  : !tracingEnabled
                    ? "Review tracing settings"
                    : "Open Playground"}
                <ArrowUpRight data-icon="inline-end" />
              </a>
            </Button>
          )}
        </>
      )}
    </div>
  )
}

function CallOutcomes({
  totals,
  loading,
}: {
  totals: UsageTotals | undefined
  loading: boolean
}) {
  const calls = totals?.call_count ?? 0
  const success = totals?.successful_call_count ?? 0
  const failed = totals?.failed_call_count ?? 0
  const other = Math.max(0, calls - success - failed)
  const percent = (value: number) =>
    calls ? `${((value / calls) * 100).toFixed(1)}%` : "—"
  return (
    <section
      aria-label="Recorded call outcomes"
      className="flex min-w-0 flex-col rounded-xl border bg-card p-4 sm:p-6"
    >
      <h3 className="font-semibold">Call outcomes</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        For the applied scope and period
      </p>
      {loading ? (
        <div className="flex flex-1 flex-col justify-center gap-4 py-8">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <>
          <div className="mt-7">
            <p className="text-3xl font-semibold tracking-tight tabular-nums">
              {totals ? calls.toLocaleString() : "—"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Recorded provider attempts
            </p>
          </div>
          <figure className="my-6">
            <div
              className="flex h-3 overflow-hidden rounded-full bg-muted"
              aria-hidden="true"
            >
              <span
                style={{
                  width: calls ? `${(success / calls) * 100}%` : "0%",
                  backgroundColor: "var(--analytics-volume)",
                }}
              />
              <span
                className="bg-destructive"
                style={{ width: calls ? `${(failed / calls) * 100}%` : "0%" }}
              />
              {other > 0 && (
                <span
                  className="bg-muted-foreground"
                  style={{ width: `${(other / calls) * 100}%` }}
                />
              )}
            </div>
            <figcaption className="sr-only">
              {success} successful and {failed} unsuccessful out of {calls}{" "}
              recorded calls.
              {other > 0 ? ` ${other} other recorded calls.` : ""}
            </figcaption>
          </figure>
          <dl className="flex flex-col gap-4 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="flex items-center gap-2">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: "var(--analytics-volume)" }}
                />
                Successful
              </dt>
              <dd className="text-right tabular-nums">
                {totals ? success.toLocaleString() : "—"}
                <span className="ml-2 text-xs text-muted-foreground">
                  {percent(success)}
                </span>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-destructive" />
                Unsuccessful
              </dt>
              <dd className="text-right tabular-nums">
                {totals ? failed.toLocaleString() : "—"}
                <span className="ml-2 text-xs text-muted-foreground">
                  {percent(failed)}
                </span>
              </dd>
            </div>
            {other > 0 && (
              <div className="flex items-center justify-between gap-2">
                <dt>Other recorded</dt>
                <dd className="tabular-nums">
                  {other.toLocaleString()} · {percent(other)}
                </dd>
              </div>
            )}
          </dl>
          <p className="mt-auto pt-6 text-xs leading-5 text-muted-foreground">
            {calls
              ? "Unsuccessful includes failed and timed-out attempts. Traced calls are not billing records."
              : "Outcome shares appear when this period has recorded calls."}
          </p>
        </>
      )}
    </section>
  )
}
