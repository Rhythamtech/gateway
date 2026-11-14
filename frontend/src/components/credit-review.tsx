import * as React from "react"
import { IconRefresh } from "@tabler/icons-react"

import {
  listCreditUsage,
  type CreditUsage,
  type CreditUsageStatusFilter,
} from "@/lib/auth"
import {
  chargeDisplayedText,
  formatCredits,
  formatTokenCount,
} from "@/lib/credits"
import { formatTimestampInDeviceZone, parseApiTimestamp } from "@/lib/datetime"
import {
  ReviewEvidenceDrawer,
  UsageStatusBadge,
} from "@/components/credit-drawers"
import { CreditPaginationBar } from "@/components/credit-tracking"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const PAGE_SIZE = 20

const STATUS_OPTIONS: Array<{
  value: CreditUsageStatusFilter | "all"
  label: string
}> = [
  { value: "needs_review", label: "Needs review" },
  { value: "reserved", label: "Reserved" },
  { value: "dispatched", label: "Dispatched" },
  { value: "usage_recorded", label: "Usage recorded" },
  { value: "settled", label: "Settled" },
  { value: "released", label: "Released" },
  { value: "all", label: "All statuses" },
]

function formatDateTime(value: string): string {
  const date = parseApiTimestamp(value)
  return date === null ? value : formatTimestampInDeviceZone(date)
}

function shortId(value: string): string {
  return `${value.slice(0, 8)}…`
}

type UsagePage = {
  items: CreditUsage[]
  total: number
}

export function CreditReviewContent() {
  const [statusFilter, setStatusFilter] = React.useState<
    CreditUsageStatusFilter | "all"
  >("needs_review")
  const [userIdFilter, setUserIdFilter] = React.useState("")
  const [applied, setApplied] = React.useState<{
    status: CreditUsageStatusFilter | "all"
    userId: string
  }>({ status: "needs_review", userId: "" })
  const [page, setPage] = React.useState(1)
  const [data, setData] = React.useState<UsagePage | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [tick, setTick] = React.useState(0)
  const [selected, setSelected] = React.useState<CreditUsage | null>(null)

  React.useEffect(() => {
    let cancelled = false

    listCreditUsage({
      page,
      pageSize: PAGE_SIZE,
      status: applied.status === "all" ? undefined : applied.status,
      userId: applied.userId || undefined,
    })
      .then((result) => {
        if (cancelled) return
        setData({ items: result.items, total: result.total })
        setError(null)
        const lastPage = Math.max(1, Math.ceil(result.total / result.page_size))
        if (result.items.length === 0 && page > lastPage) setPage(lastPage)
      })
      .catch((requestError: unknown) => {
        if (cancelled) return
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load usage records."
        )
      })

    return () => {
      cancelled = true
    }
  }, [applied, page, tick])

  function applyFilters() {
    setApplied({ status: statusFilter, userId: userIdFilter.trim() })
    setPage(1)
  }

  function resetFilters() {
    setStatusFilter("needs_review")
    setUserIdFilter("")
    setApplied({ status: "needs_review", userId: "" })
    setPage(1)
  }

  function refreshAfterResolution() {
    setSelected(null)
    setTick((value) => value + 1)
  }

  const isDefaultFilter =
    applied.status === "needs_review" && applied.userId === ""

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex max-w-prose flex-col gap-1">
          <h2 className="text-lg font-semibold">Unresolved credit holds</h2>
          <p className="text-sm text-muted-foreground">
            Requests with reported usage settle automatically. If usage is
            missing after a timeout or interrupted response, the hold stays in
            place until a superuser can verify what the provider charged.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setTick((v) => v + 1)}
          className="gap-1.5"
        >
          <IconRefresh className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3.5 text-sm">
        <div className="flex items-center gap-2">
          <label
            htmlFor="review-status"
            className="text-xs font-medium text-muted-foreground"
          >
            Status:
          </label>
          <Select
            value={statusFilter}
            onValueChange={(next) =>
              setStatusFilter(next as CreditUsageStatusFilter | "all")
            }
          >
            <SelectTrigger id="review-status" className="h-8 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <label
            htmlFor="review-user-id"
            className="text-xs font-medium text-muted-foreground"
          >
            User ID:
          </label>
          <Input
            id="review-user-id"
            value={userIdFilter}
            onChange={(e) => setUserIdFilter(e.target.value)}
            placeholder="User UUID…"
            className="h-8 w-44 font-mono text-xs"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Button size="sm" className="h-8" onClick={applyFilters}>
            Apply
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={resetFilters}
            disabled={statusFilter === "needs_review" && userIdFilter === ""}
          >
            Reset
          </Button>
        </div>

        {data ? (
          <div className="ml-auto text-xs text-muted-foreground tabular-nums">
            Matching records:{" "}
            <span className="font-medium text-foreground">
              {data.total.toLocaleString("en-US")}
            </span>
          </div>
        ) : null}
      </div>

      <div className="@container/review min-w-0">
        {error !== null ? (
          <div className="flex flex-col items-start gap-2 py-4">
            <p className="text-sm text-destructive">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTick((value) => value + 1)}
            >
              Try again
            </Button>
          </div>
        ) : data === null ? (
          <div className="flex flex-col gap-3 py-4">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-4 w-52" />
          </div>
        ) : data.items.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-lg border bg-card p-6">
            <p className="text-sm font-medium">
              {isDefaultFilter
                ? "You’re all caught up"
                : "No usage records match the current filters."}
            </p>
            <p className="text-sm text-muted-foreground">
              {isDefaultFilter
                ? "If a hold needs review, use provider evidence to settle verified usage or release a confirmed uncharged request."
                : "Try adjusting the status or user ID filters to find records."}
            </p>
            {!isDefaultFilter ? (
              <Button
                variant="outline"
                size="sm"
                onClick={resetFilters}
                className="mt-2"
              >
                Reset filters
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <ul
              className="flex flex-col divide-y @3xl/review:hidden"
              aria-label="Usage records"
            >
              {data.items.map((usage) => (
                <li
                  key={usage.id}
                  className="flex min-w-0 flex-col gap-2 py-3.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(usage.created_at)}
                    </span>
                    <UsageStatusBadge status={usage.status} />
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        title={usage.request_id}
                        className="font-mono text-xs font-medium"
                      >
                        Req: {shortId(usage.request_id)}
                      </span>
                      <span
                        title={usage.user_id}
                        className="font-mono text-xs text-muted-foreground"
                      >
                        User: {shortId(usage.user_id)}
                      </span>
                    </div>
                    <span
                      title={usage.provider_model_id}
                      className="truncate font-mono text-xs text-muted-foreground"
                    >
                      {usage.provider_model_id}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/40 p-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Input: </span>
                      <span className="font-medium tabular-nums">
                        {formatTokenCount(usage.input_tokens)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Output: </span>
                      <span className="font-medium tabular-nums">
                        {formatTokenCount(usage.output_tokens)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Hold: </span>
                      <span className="font-medium tabular-nums">
                        {formatCredits(usage.reserved_credits)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Charged: </span>
                      <span className="font-medium tabular-nums">
                        {chargeDisplayedText(
                          usage.status,
                          usage.charged_credits
                        )}
                      </span>
                    </div>
                  </div>

                  <Button
                    variant={
                      usage.status === "needs_review" ? "default" : "outline"
                    }
                    size="sm"
                    className="self-start"
                    onClick={() => setSelected(usage)}
                  >
                    {usage.status === "needs_review" ? "Review" : "Inspect"}
                  </Button>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto rounded-lg border @3xl/review:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Request / User</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Input tokens</TableHead>
                    <TableHead className="text-right">Output tokens</TableHead>
                    <TableHead className="text-right">Hold</TableHead>
                    <TableHead className="text-right">Charged</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[80px] text-right">
                      <span className="sr-only">Action</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((usage) => (
                    <TableRow key={usage.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(usage.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span
                            title={usage.request_id}
                            className="font-mono text-xs font-medium"
                          >
                            {shortId(usage.request_id)}
                          </span>
                          <span
                            title={usage.user_id}
                            className="font-mono text-[11px] text-muted-foreground"
                          >
                            User {shortId(usage.user_id)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell
                        title={usage.provider_model_id}
                        className="max-w-44 truncate font-mono text-xs"
                      >
                        {usage.provider_model_id}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {usage.input_tokens === null ? (
                          <span className="text-muted-foreground">
                            Not reported
                          </span>
                        ) : (
                          usage.input_tokens.toLocaleString("en-US")
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {usage.output_tokens === null ? (
                          <span className="text-muted-foreground">
                            Not reported
                          </span>
                        ) : (
                          usage.output_tokens.toLocaleString("en-US")
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCredits(usage.reserved_credits)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {chargeDisplayedText(
                          usage.status,
                          usage.charged_credits
                        )}
                      </TableCell>
                      <TableCell>
                        <UsageStatusBadge status={usage.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant={
                            usage.status === "needs_review"
                              ? "default"
                              : "outline"
                          }
                          size="sm"
                          onClick={() => setSelected(usage)}
                        >
                          {usage.status === "needs_review"
                            ? "Review"
                            : "Inspect"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <CreditPaginationBar
              page={page}
              pageSize={PAGE_SIZE}
              total={data.total}
              onPage={setPage}
            />
          </div>
        )}
      </div>

      {selected ? (
        <ReviewEvidenceDrawer
          key={selected.id}
          usage={selected}
          onClose={() => setSelected(null)}
          onResolved={refreshAfterResolution}
        />
      ) : null}
    </div>
  )
}
