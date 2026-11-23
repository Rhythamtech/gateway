import * as React from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
  OverviewAreaChart,
  OverviewMetrics,
} from "@/components/overview-analytics"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { listCallTraces, listCreditUsage, listProviders } from "@/lib/auth"
import { formatCredits } from "@/lib/credits"
import { formatTimestampInDeviceZone, parseApiTimestamp } from "@/lib/datetime"

const SAMPLE_SIZE = 100
const dayLabel = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

function useGatewayResource<T>(
  scope: string,
  refresh: number,
  load: (signal: AbortSignal) => Promise<T>
) {
  const [attempt, setAttempt] = React.useState(0)
  const request = React.useMemo(
    () => ({ scope, refresh, attempt, load }),
    [scope, refresh, attempt, load]
  )
  const [result, setResult] = React.useState<{
    request: typeof request
    data?: T
    failed?: boolean
  }>()

  React.useEffect(() => {
    const controller = new AbortController()
    void request.load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ request, data })
      },
      () => {
        if (!controller.signal.aborted) {
          setResult((previous) => ({
            request,
            data:
              previous?.request.scope === request.scope
                ? previous.data
                : undefined,
            failed: true,
          }))
        }
      }
    )
    return () => controller.abort()
  }, [request])

  const data = result?.request.scope === scope ? result.data : undefined
  const pending = result?.request !== request
  return {
    data,
    loading: pending && data === undefined,
    failed: !pending && Boolean(result?.failed),
    retry: () => setAttempt((previous) => previous + 1),
  }
}

function loadCreditReviews(signal: AbortSignal) {
  return listCreditUsage({ pageSize: 5, status: "needs_review" }, signal)
}

export function GatewayOverview() {
  const [tab, setTab] = React.useState("failed")
  const [period, setPeriod] = React.useState("30")
  const [refresh, setRefresh] = React.useState(0)
  const to = new Date().toISOString().slice(0, 10)
  const start = new Date(`${to}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - Number(period) + 1)
  const from = start.toISOString().slice(0, 10)
  const range = `${from}:${to}`

  const callResource = useGatewayResource(
    range,
    refresh,
    React.useCallback(
      (signal: AbortSignal) =>
        listCallTraces(
          { pageSize: SAMPLE_SIZE, filters: { from, to } },
          signal
        ),
      [from, to]
    )
  )
  const failedResource = useGatewayResource(
    range,
    refresh,
    React.useCallback(
      (signal: AbortSignal) =>
        listCallTraces(
          { pageSize: 5, filters: { from, to, status: "failed" } },
          signal
        ),
      [from, to]
    )
  )
  const timeoutResource = useGatewayResource(
    range,
    refresh,
    React.useCallback(
      (signal: AbortSignal) =>
        listCallTraces(
          { pageSize: 5, filters: { from, to, status: "timeout" } },
          signal
        ),
      [from, to]
    )
  )
  const providerResource = useGatewayResource("current", refresh, listProviders)
  const reviewResource = useGatewayResource(
    "current",
    refresh,
    loadCreditReviews
  )
  const { data: calls } = callResource
  const { data: failed } = failedResource
  const { data: timeouts } = timeoutResource
  const { data: providers } = providerResource
  const { data: reviews } = reviewResource
  const failures =
    failed && timeouts ? failed.total + timeouts.total : undefined
  const outcomesFailed = failedResource.failed || timeoutResource.failed
  const outcomesLoading =
    !outcomesFailed && (failedResource.loading || timeoutResource.loading)
  const rows = [...(failed?.items ?? []), ...(timeouts?.items ?? [])]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 5)
  const sampled = calls !== undefined && calls.total > calls.items.length
  const buckets = new Map<
    string,
    { date: string; calls: number; successful: number }
  >()
  const latency = [
    { label: "< 250 ms", limit: 250, count: 0 },
    { label: "250 ms–1 s", limit: 1000, count: 0 },
    { label: "1–3 s", limit: 3000, count: 0 },
    { label: "3–10 s", limit: 10000, count: 0 },
    { label: "≥ 10 s", limit: Infinity, count: 0 },
  ]
  const providersByCall = new Map<string, { label: string; count: number }>()
  for (const call of calls?.items ?? []) {
    const provider = call.provider_model
    const providerId = provider?.provider_id ?? ""
    const providerCount = providersByCall.get(providerId) ?? {
      label: provider?.provider_name ?? "Unknown provider",
      count: 0,
    }
    providerCount.count++
    providersByCall.set(providerId, providerCount)
    const latencyMs = call.latency_ms
    if (latencyMs !== null) {
      const bucket = latency.find(({ limit }) => latencyMs < limit)
      if (bucket) bucket.count++
    }

    const date = parseApiTimestamp(call.created_at)?.toISOString().slice(0, 10)
    if (!date) continue
    const day = buckets.get(date) ?? { date, calls: 0, successful: 0 }
    day.calls++
    if (call.status === "success") day.successful++
    buckets.set(date, day)
  }
  const daily = []
  const oldestSampleDay = [...buckets.keys()].at(-1)
  for (
    let day = new Date(`${sampled ? (oldestSampleDay ?? to) : from}T00:00:00Z`);
    calls && day.toISOString().slice(0, 10) <= to;
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    const date = day.toISOString().slice(0, 10)
    daily.push(buckets.get(date) ?? { date, calls: 0, successful: 0 })
  }
  const providerActivity = [...providersByCall.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 5)
  const sampleScope = sampled
    ? `Based on the latest ${calls.items.length} traced calls.`
    : ""
  const latencySamples = latency.reduce(
    (total, bucket) => total + bucket.count,
    0
  )
  const charts = [
    {
      title: "Failed and timed-out calls",
      loading: outcomesLoading,
      data:
        failures && failed && timeouts
          ? [
              { label: "Failed", count: failed.total },
              {
                label: "Timed out",
                count: timeouts.total,
                fill: "var(--analytics-timeout)",
              },
            ]
          : [],
      emptyMessage:
        failures === undefined
          ? "Call outcomes could not be loaded."
          : "No unsuccessful calls in this period.",
      color: "var(--destructive)",
    },
    {
      title: "Latency distribution",
      loading: callResource.loading,
      description: `${latencySamples.toLocaleString()} measured attempts.${sampleScope ? ` ${sampleScope}` : ""}`,
      data: latencySamples ? latency : [],
      emptyMessage: calls
        ? "No latency measurements in this period."
        : "Latency data could not be loaded.",
      color: "var(--analytics-latency)",
    },
    {
      title: "Top providers by call count",
      loading: callResource.loading,
      description: sampleScope,
      data: providerActivity,
      emptyMessage: calls
        ? "No traced calls in this period."
        : "Provider activity could not be loaded.",
      color: "var(--analytics-volume)",
    },
  ]
  const metrics = [
    {
      label: "Traced calls",
      value: calls?.total.toLocaleString(),
      loading: callResource.loading,
      onRetry: callResource.failed ? callResource.retry : undefined,
      badge: "Selected period",
      headline: "Open request traces",
      detail: "Recorded provider attempts across accounts",
      href: "/dashboard/traces",
    },
    {
      label: "Failed or timed out",
      value: failures?.toLocaleString(),
      loading: outcomesLoading,
      onRetry: outcomesFailed
        ? () => {
            if (failedResource.failed) failedResource.retry()
            if (timeoutResource.failed) timeoutResource.retry()
          }
        : undefined,
      badge: "Selected period",
      headline: "Investigate unsuccessful calls",
      detail: timeouts
        ? `${timeouts.total.toLocaleString()} timed out`
        : "Failed and timed-out provider attempts",
      href: "#gateway-activity",
      onClick: () => setTab("failed"),
    },
    {
      label: "Credit reviews",
      value: reviews?.total.toLocaleString(),
      loading: reviewResource.loading,
      onRetry: reviewResource.failed ? reviewResource.retry : undefined,
      badge: "Current",
      headline: "Open credit review",
      detail: "Usage records waiting for a decision",
      href: "/dashboard/credit-review",
    },
    {
      label: "Enabled providers",
      loading: providerResource.loading,
      onRetry: providerResource.failed ? providerResource.retry : undefined,
      value: providers
        ?.filter((provider) => provider.is_enabled)
        .length.toLocaleString(),
      badge: "Current",
      headline: "Manage providers",
      detail: providers
        ? `${providers.length.toLocaleString()} configured providers`
        : "Provider configuration",
      href: "/dashboard/providers",
    },
  ]

  return (
    <div className="dashboard-analytics @container/gateway flex min-w-0 flex-col gap-6">
      <OverviewMetrics metrics={metrics} />
      <section
        aria-labelledby="gateway-chart-heading"
        className="min-w-0 rounded-xl border bg-card p-4 sm:p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="gateway-chart-heading" className="font-semibold">
              Gateway call activity
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {sampled
                ? `Latest ${calls.items.length} traced calls. The first UTC day may be partial.`
                : "Traced calls per UTC day"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRefresh((value) => value + 1)}
            >
              Refresh
            </Button>
            <ToggleGroup
              type="single"
              variant="outline"
              value={period}
              onValueChange={(value) => value && setPeriod(value)}
              aria-label="Gateway reporting period"
            >
              <ToggleGroupItem
                value="90"
                aria-label="Last 90 days"
                className="px-2! text-xs sm:px-3! sm:text-sm"
              >
                <span className="hidden sm:inline">Last </span>90 days
              </ToggleGroupItem>
              <ToggleGroupItem
                value="30"
                aria-label="Last 30 days"
                className="px-2! text-xs sm:px-3! sm:text-sm"
              >
                <span className="hidden sm:inline">Last </span>30 days
              </ToggleGroupItem>
              <ToggleGroupItem
                value="7"
                aria-label="Last 7 days"
                className="px-2! text-xs sm:px-3! sm:text-sm"
              >
                <span className="hidden sm:inline">Last </span>7 days
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
        <div className="mt-6">
          {callResource.loading ? (
            <Skeleton className="h-64 w-full" />
          ) : calls?.items.length ? (
            <OverviewAreaChart
              data={daily}
              formatLabel={(date) =>
                dayLabel.format(new Date(`${date}T00:00:00Z`))
              }
              series={{
                calls: {
                  label: "Traced calls",
                  color: "var(--analytics-volume)",
                },
                successful: {
                  label: "Successful",
                  color: "var(--analytics-success)",
                },
              }}
            />
          ) : (
            <p className="py-20 text-center text-sm text-muted-foreground">
              {calls
                ? "No traced calls in this period."
                : "Call activity could not be loaded."}
            </p>
          )}
        </div>
      </section>
      <section
        aria-label="Gateway analytics charts"
        className="grid min-w-0 gap-4 @min-[680px]/gateway:grid-cols-2 @min-[1080px]/gateway:grid-cols-3"
      >
        {charts.map((chart) => (
          <section
            key={chart.title}
            className="min-w-0 rounded-xl border bg-card p-4 sm:p-6 last:@min-[680px]/gateway:col-span-2 last:@min-[1080px]/gateway:col-span-1"
          >
            <div className="mb-4">
              <h3 className="font-semibold">{chart.title}</h3>
              {chart.description && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {chart.description}
                </p>
              )}
            </div>
            {chart.loading ? (
              <Skeleton className="h-52 w-full" />
            ) : chart.data.length ? (
              <ChartContainer
                className="aspect-auto h-52 w-full"
                config={{
                  count: { label: "Traced calls", color: chart.color },
                }}
              >
                <BarChart<{ label: string; count: number; fill?: string }>
                  accessibilityLayer
                  data={chart.data}
                  layout="vertical"
                  margin={{ right: 12 }}
                >
                  <CartesianGrid horizontal={false} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={88}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(label: string) =>
                      label.length > 14 ? `${label.slice(0, 13)}…` : label
                    }
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="count"
                    fill="var(--color-count)"
                    radius={[0, 4, 4, 0]}
                    maxBarSize={24}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ChartContainer>
            ) : (
              <p className="grid h-52 place-items-center text-center text-sm text-muted-foreground">
                {chart.emptyMessage}
              </p>
            )}
          </section>
        ))}
      </section>
      <Tabs
        id="gateway-activity"
        value={tab}
        onValueChange={setTab}
        className="scroll-mt-4 gap-4"
      >
        <TabsList
          aria-label="Gateway activity tables"
          className="h-auto! max-w-full flex-wrap justify-start"
        >
          <TabsTrigger value="failed">Failed calls</TabsTrigger>
          <TabsTrigger value="reviews">Credit review</TabsTrigger>
          <TabsTrigger value="providers">Providers</TabsTrigger>
        </TabsList>
        <TabsContent value="failed">
          <GatewayTable
            headers={[
              "Provider model",
              "Outcome",
              "Error code",
              "Latency",
              "Recorded",
            ]}
            status={
              outcomesLoading
                ? "Loading calls…"
                : failures === undefined
                  ? "Some unsuccessful calls could not be loaded."
                  : rows.length === 0
                    ? "No unsuccessful calls in this period."
                    : undefined
            }
          >
            {rows.map((call) => {
              const timestamp = parseApiTimestamp(call.created_at)
              return (
                <TableRow key={call.id}>
                  <TableCell>
                    <a
                      className="font-medium underline-offset-4 hover:underline"
                      href={`/dashboard/traces/detail?id=${encodeURIComponent(call.message_trace_id)}`}
                    >
                      {call.provider_model
                        ? `${call.provider_model.provider_name} / ${call.provider_model.model_id}`
                        : (call.gateway_model?.model_id ?? "Unknown model")}
                    </a>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {call.status === "timeout" ? "Timeout" : "Failed"}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {call.error_code ?? "—"}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {call.latency_ms == null
                      ? "—"
                      : `${call.latency_ms.toLocaleString()} ms`}
                  </TableCell>
                  <TableCell>
                    {timestamp ? formatTimestampInDeviceZone(timestamp) : "—"}
                  </TableCell>
                </TableRow>
              )
            })}
          </GatewayTable>
        </TabsContent>
        <TabsContent value="reviews">
          <GatewayTable
            headers={["Request", "Reserved credits", "Reason"]}
            status={
              reviewResource.loading
                ? "Loading credit reviews…"
                : !reviews
                  ? "Credit reviews could not be loaded."
                  : reviews.items.length === 0
                    ? "No credit reviews waiting."
                    : undefined
            }
          >
            {reviews?.items.map((review) => (
              <TableRow key={review.id}>
                <TableCell className="font-mono text-xs">
                  {review.request_id}
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatCredits(review.reserved_credits)}
                </TableCell>
                <TableCell className="whitespace-normal">
                  {review.reason ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </GatewayTable>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <a href="/dashboard/credit-review">Open credit review</a>
          </Button>
        </TabsContent>
        <TabsContent value="providers">
          <GatewayTable
            headers={["Provider", "Protocol", "Configuration"]}
            status={
              providerResource.loading
                ? "Loading providers…"
                : !providers
                  ? "Providers could not be loaded."
                  : providers.length === 0
                    ? "No providers configured."
                    : undefined
            }
          >
            {providers?.map((provider) => (
              <TableRow key={provider.id}>
                <TableCell>
                  <a
                    className="font-medium underline-offset-4 hover:underline"
                    href={`/dashboard/providers/detail?id=${encodeURIComponent(provider.id)}`}
                  >
                    {provider.name}
                  </a>
                </TableCell>
                <TableCell>{provider.protocol}</TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {provider.is_enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </GatewayTable>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function GatewayTable({
  headers,
  status,
  children,
}: {
  headers: string[]
  status?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow>
            {headers.map((header) => (
              <TableHead key={header}>{header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {status && (
            <TableRow>
              <TableCell
                colSpan={headers.length}
                className="h-14 text-center whitespace-normal text-muted-foreground"
              >
                {status}
              </TableCell>
            </TableRow>
          )}
          {children}
        </TableBody>
      </Table>
    </div>
  )
}
