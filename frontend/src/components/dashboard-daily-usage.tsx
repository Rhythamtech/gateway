import * as React from "react"
import { Activity, Download, ChevronLeft, ChevronRight } from "lucide-react"
import type { DailyUsageEntry } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const PAGE_SIZE = 7
const formatDate = (value: string) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })

/** Automatic, real daily breakdown for exactly the overview's applied scope. */
export default function DashboardDailyUsage({
  daily,
  from,
  to,
  loading,
  unavailable,
  scopeLabel,
}: {
  daily: DailyUsageEntry[]
  from: string
  to: string
  loading: boolean
  unavailable: boolean
  scopeLabel: string
}) {
  const [page, setPage] = React.useState(1)
  const sorted = React.useMemo(
    () => [...daily].sort((a, b) => b.date.localeCompare(a.date)),
    [daily]
  )
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const visible = sorted.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  )
  const largest = Math.max(1, ...daily.map((day) => day.call_count))
  const calls = daily.reduce((sum, day) => sum + day.call_count, 0)
  const tokens = daily.reduce(
    (sum, day) => sum + day.input_tokens + day.output_tokens,
    0
  )
  function exportCsv() {
    const fields = [
      "date_utc",
      "calls",
      "successful_calls",
      "unsuccessful_calls",
      "input_tokens",
      "output_tokens",
      "average_latency_ms",
    ]
    const records = sorted.map((day) => [
      day.date,
      day.call_count,
      day.successful_call_count,
      day.failed_call_count,
      day.input_tokens,
      day.output_tokens,
      day.average_latency_ms ?? "",
    ])
    const csv = [fields, ...records]
      .map((row) =>
        row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")
      )
      .join("\r\n")
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" })
    )
    const link = document.createElement("a")
    link.href = url
    link.download = `gateway-daily-usage-${from}-${to}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <section
      id="dashboard-daily-usage"
      aria-label="Daily usage breakdown"
      aria-busy={loading}
      className="@container/daily min-w-0 scroll-mt-4 overflow-hidden rounded-xl border bg-card"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b p-4 sm:p-5">
        <div>
          <h3 className="text-base font-semibold">Daily usage</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {scopeLabel} · {from} – {to} · UTC
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={loading || !daily.length}
          onClick={exportCsv}
        >
          <Download data-icon="inline-start" />
          Export CSV
        </Button>
      </header>
      <div className="grid grid-cols-2 divide-x border-b bg-muted/15">
        <div className="p-4 sm:px-5">
          <p className="text-xs text-muted-foreground">Recorded calls</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {loading || unavailable ? "—" : calls.toLocaleString()}
          </p>
        </div>
        <div className="p-4 sm:px-5">
          <p className="text-xs text-muted-foreground">Reported tokens</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {loading || unavailable ? "—" : tokens.toLocaleString()}
          </p>
        </div>
      </div>
      {loading ? (
        <div
          role="status"
          aria-label="Loading daily usage"
          className="flex flex-col gap-4 p-5"
        >
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : !visible.length ? (
        <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
          <Activity className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">
            {unavailable
              ? "Daily usage unavailable"
              : "No daily records in this period"}
          </p>
          <p className="max-w-xs text-xs leading-5 text-muted-foreground">
            {unavailable
              ? "Retry loading analytics using Refresh above."
              : "Choose another period or record traffic with tracing enabled."}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4 sm:pl-5">Day · UTC</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Outcomes</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="pr-4 text-right sm:pr-5">
                    Avg latency
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((day) => (
                  <TableRow key={day.date}>
                    <TableCell className="min-w-32 py-4 pl-4 sm:pl-5">
                      <time dateTime={day.date} className="text-xs font-medium">
                        {formatDate(day.date)}
                      </time>
                      <div
                        className="mt-2 h-1 w-24 overflow-hidden rounded-full bg-muted"
                        aria-hidden="true"
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${(day.call_count / largest) * 100}%`,
                            backgroundColor: "var(--analytics-volume)",
                          }}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium tabular-nums">
                      {day.call_count.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      <p>
                        {day.successful_call_count.toLocaleString()} successful
                      </p>
                      <p
                        className={
                          day.failed_call_count
                            ? "mt-1 text-destructive"
                            : "mt-1 text-muted-foreground"
                        }
                      >
                        {day.failed_call_count.toLocaleString()} unsuccessful
                      </p>
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      <p>{day.input_tokens.toLocaleString()} in</p>
                      <p className="mt-1 text-muted-foreground">
                        {day.output_tokens.toLocaleString()} out
                      </p>
                    </TableCell>
                    <TableCell className="pr-4 text-right text-xs tabular-nums sm:pr-5">
                      {day.average_latency_ms == null
                        ? "—"
                        : `${(day.average_latency_ms / 1000).toFixed(2)} s`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 sm:px-5">
            <p className="text-xs text-muted-foreground">
              {(currentPage - 1) * PAGE_SIZE + 1}–
              {Math.min(currentPage * PAGE_SIZE, sorted.length)} of{" "}
              {sorted.length} recorded days
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="outline"
                aria-label="Previous daily usage page"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft />
              </Button>
              <span className="text-xs tabular-nums">
                {currentPage} / {totalPages}
              </span>
              <Button
                size="icon"
                variant="outline"
                aria-label="Next daily usage page"
                disabled={currentPage >= totalPages}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </>
      )}
      <p className="border-t px-4 py-3 text-xs leading-5 text-muted-foreground sm:px-5">
        Newest recorded day first. Bar length is relative to the busiest
        recorded day in this range. Missing token usage is not estimated;
        missing latency is shown as a dash.
      </p>
    </section>
  )
}
