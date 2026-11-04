import * as React from "react"

import {
  listCreditUsage,
  type CreditUsage,
  type CreditUsageStatusFilter,
} from "@/lib/auth"
import { formatCredits } from "@/lib/credits"
import { formatTimestampInDeviceZone, parseApiTimestamp } from "@/lib/datetime"
import {
  ReviewEvidenceDrawer,
  UsageStatusBadge,
} from "@/components/credit-drawers"
import { CreditPaginationBar } from "@/components/credit-tracking"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

function statusLabel(value: CreditUsageStatusFilter | "all"): string {
  return STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value
}

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

  return (
    <>
      <div className="flex flex-col items-start justify-between gap-2 px-4 lg:flex-row lg:items-center lg:px-6">
        <p className="text-sm text-muted-foreground">
          Requests whose credit holds need a superuser decision. Settling
          charges the verified token counts against the recorded rate; releasing
          returns the full hold without a charge.
        </p>
      </div>
      <div className="px-4 lg:px-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filters</CardTitle>
            <CardDescription>
              The queue opens with requests that need review. The counts below
              describe the current query, not the whole ledger.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="review-status">Status</Label>
              <Select
                value={statusFilter}
                onValueChange={(next) =>
                  setStatusFilter(next as CreditUsageStatusFilter | "all")
                }
              >
                <SelectTrigger id="review-status" className="w-44">
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
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="review-user">User ID</Label>
              <Input
                id="review-user"
                value={userIdFilter}
                onChange={(event) => setUserIdFilter(event.target.value)}
                placeholder="Optional user UUID"
                className="sm:max-w-xs"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={applyFilters}>Apply</Button>
              <Button variant="outline" onClick={resetFilters}>
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="px-4 pb-4 lg:px-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Usage records · {statusLabel(applied.status)}
            </CardTitle>
            {data ? (
              <CardDescription>
                {data.total.toLocaleString("en-US")} record
                {data.total === 1 ? "" : "s"} match this query.
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="min-w-0">
            {error !== null ? (
              <div className="flex flex-col items-start gap-2 py-2">
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
              <div className="flex flex-col gap-3.5 py-2">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-4 w-52" />
              </div>
            ) : data.items.length === 0 ? (
              <div className="flex flex-col items-start gap-1.5 py-4">
                <p className="text-sm font-medium">No usage records found.</p>
                <p className="text-sm text-muted-foreground">
                  Nothing matches the current filters.
                </p>
              </div>
            ) : (
              <div className="@container/review flex flex-col gap-4">
                <ul
                  className="flex flex-col divide-y @4xl/review:hidden"
                  aria-label="Usage records"
                >
                  {data.items.map((usage) => (
                    <li
                      key={usage.id}
                      className="flex min-w-0 flex-col gap-1.5 py-3.5"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span
                          title={usage.user_id}
                          className="min-w-0 truncate font-mono text-xs text-muted-foreground"
                        >
                          {shortId(usage.user_id)}
                        </span>
                        <UsageStatusBadge status={usage.status} />
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="flex items-baseline gap-2">
                          <span className="text-xs text-muted-foreground">
                            Held
                          </span>
                          <span className="text-sm font-medium tabular-nums">
                            {formatCredits(usage.reserved_credits)}
                          </span>
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelected(usage)}
                        >
                          Review
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto @4xl/review:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Provider model ID</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Held</TableHead>
                        <TableHead>Charged</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="sr-only">Review</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.items.map((usage) => (
                        <TableRow key={usage.id}>
                          <TableCell
                            title={usage.user_id}
                            className="font-mono text-xs"
                          >
                            {shortId(usage.user_id)}
                          </TableCell>
                          <TableCell
                            title={usage.provider_model_id}
                            className="max-w-56 truncate font-mono text-xs"
                          >
                            {usage.provider_model_id}
                          </TableCell>
                          <TableCell
                            title={usage.provider_id}
                            className="font-mono text-xs"
                          >
                            {shortId(usage.provider_id)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {formatDateTime(usage.created_at)}
                          </TableCell>
                          <TableCell className="font-medium tabular-nums">
                            {formatCredits(usage.reserved_credits)}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {formatCredits(usage.charged_credits)}
                          </TableCell>
                          <TableCell>
                            <UsageStatusBadge status={usage.status} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelected(usage)}
                            >
                              Review
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
          </CardContent>
        </Card>
      </div>

      {selected ? (
        <ReviewEvidenceDrawer
          key={selected.id}
          usage={selected}
          onClose={() => setSelected(null)}
          onResolved={refreshAfterResolution}
        />
      ) : null}
    </>
  )
}
