import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"

type Metric = {
  label: string
  value?: string
  badge: string
  headline: string
  detail: string
  href?: string
  onClick?: () => void
  loading?: boolean
  onRetry?: () => void
}

export function OverviewMetrics({ metrics }: { metrics: Metric[] }) {
  return (
    <section
      aria-label="Overview metrics"
      className="grid min-w-0 gap-4 sm:grid-cols-2"
    >
      {metrics.map((metric) => (
        <Card
          key={metric.label}
          className="min-h-44 gap-5 bg-linear-to-t from-muted/55 to-card p-5 sm:p-6"
        >
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">
                {metric.label}
              </h2>
              <Badge variant="outline" className="rounded-full">
                {metric.badge}
              </Badge>
            </div>
            {metric.loading ? (
              <Skeleton className="h-9 w-24" />
            ) : (
              <p className="text-3xl font-semibold tracking-tight tabular-nums">
                {metric.value ?? "—"}
              </p>
            )}
          </div>
          <div className="mt-auto space-y-1 text-sm">
            {metric.href ? (
              <a
                href={metric.href}
                onClick={metric.onClick}
                className="font-medium underline-offset-4 hover:underline"
              >
                {metric.headline}
              </a>
            ) : (
              <p className="font-medium">{metric.headline}</p>
            )}
            <p className="text-muted-foreground">{metric.detail}</p>
            {metric.onRetry && (
              <div className="flex flex-wrap items-center gap-2" role="status">
                <span className="text-muted-foreground">
                  {metric.value === undefined
                    ? "Could not load."
                    : "Could not refresh. Showing previous data."}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Retry ${metric.label.toLowerCase()}`}
                  onClick={metric.onRetry}
                >
                  Retry
                </Button>
              </div>
            )}
          </div>
        </Card>
      ))}
    </section>
  )
}

export function OverviewAreaChart<T extends { date: string }>({
  data,
  formatLabel,
  series,
  className = "aspect-auto h-64 w-full sm:h-72",
}: {
  data: T[]
  formatLabel: (value: string) => string
  series: Record<string, { label: string; color: string }>
  className?: string
}) {
  const id = React.useId()
  return (
    <ChartContainer config={series} className={className}>
      <AreaChart accessibilityLayer data={data} margin={{ right: 12, left: 4 }}>
        <defs>
          {Object.keys(series).map((key) => (
            <linearGradient
              key={key}
              id={`${id}-${key}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="0%"
                stopColor={`var(--color-${key})`}
                stopOpacity={0.55}
              />
              <stop
                offset="100%"
                stopColor={`var(--color-${key})`}
                stopOpacity={0.04}
              />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey={(entry: T) => entry.date}
          tickFormatter={formatLabel}
          axisLine={false}
          tickLine={false}
          tick={{ fill: "var(--muted-foreground)" }}
          minTickGap={30}
        />
        <YAxis
          allowDecimals={false}
          axisLine={false}
          tickLine={false}
          tick={{ fill: "var(--muted-foreground)" }}
          width={52}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(label) =>
                typeof label === "string" ? formatLabel(label) : label
              }
            />
          }
        />
        {Object.keys(series).map((key) => (
          <Area
            key={key}
            dataKey={key}
            type="monotone"
            stroke={`var(--color-${key})`}
            fill={`url(#${id}-${key})`}
            dot={data.length === 1}
            isAnimationActive={false}
          />
        ))}
        {Object.keys(series).length > 1 && (
          <ChartLegend content={<ChartLegendContent />} />
        )}
      </AreaChart>
    </ChartContainer>
  )
}
