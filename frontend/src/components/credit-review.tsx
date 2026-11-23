import * as React from "react"
import { IconRefresh } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  listCreditUsage,
  type CreditUsage,
  type CreditUsageStatusFilter,
} from "@/lib/auth"
import {
  chargeDisplayedText,
  creditReviewReason,
  formatCredits,
} from "@/lib/credits"
import { formatTimestampInDeviceZone, parseApiTimestamp } from "@/lib/datetime"
import {
  ReviewEvidenceDrawer,
  UsageStatusBadge,
} from "@/components/credit-drawers"
import { CreditPaginationBar } from "@/components/credit-tracking"
import { ReleaseCreditHoldsDialog } from "@/components/release-credit-holds-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
  const [checked, setChecked] = React.useState(new Map<string, CreditUsage>())
  const [holdsToRelease, setHoldsToRelease] = React.useState<
    CreditUsage[] | null
  >(null)
  const [loadingAll, setLoadingAll] = React.useState(false)

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
    setChecked(new Map())
    setData(null)
    setApplied({ status: statusFilter, userId: userIdFilter.trim() })
    setPage(1)
  }

  function resetFilters() {
    setChecked(new Map())
    setData(null)
    setStatusFilter("needs_review")
    setUserIdFilter("")
    setApplied({ status: "needs_review", userId: "" })
    setPage(1)
  }

  function refreshAfterResolution() {
    if (selected) setHoldsChecked([selected], false)
    setSelected(null)
    setTick((value) => value + 1)
  }

  function setHoldsChecked(holds: CreditUsage[], isChecked: boolean) {
    setChecked((previous) => {
      const next = new Map(previous)
      for (const hold of holds) {
        if (isChecked) next.set(hold.id, hold)
        else next.delete(hold.id)
      }
      return next
    })
  }

  async function prepareReleaseAll() {
    setLoadingAll(true)
    try {
      const filters = {
        status: "needs_review" as const,
        userId: applied.userId,
        pageSize: 100,
      }
      const firstPage = await listCreditUsage({ ...filters, page: 1 })
      const holds = new Map(firstPage.items.map((hold) => [hold.id, hold]))
      const pages = Math.ceil(firstPage.total / firstPage.page_size)
      for (let nextPage = 2; nextPage <= pages; nextPage += 1) {
        const result = await listCreditUsage({ ...filters, page: nextPage })
        for (const hold of result.items) holds.set(hold.id, hold)
      }
      if (holds.size) setHoldsToRelease([...holds.values()])
      else toast.info("There are no matching holds awaiting review.")
    } catch {
      toast.error("Could not load the matching holds. Try again.")
    } finally {
      setLoadingAll(false)
    }
  }

  function selectionCheckbox(usage: CreditUsage) {
    return usage.status === "needs_review" ? (
      <Checkbox
        aria-label={`Select hold for request ${usage.request_id}`}
        checked={checked.has(usage.id)}
        onCheckedChange={(value) => setHoldsChecked([usage], value === true)}
      />
    ) : null
  }

  function rowActions(usage: CreditUsage) {
    const needsReview = usage.status === "needs_review"
    return (
      <div className="flex shrink-0 gap-1.5 whitespace-nowrap @3xl/review:justify-end">
        <Button
          variant={needsReview ? "default" : "outline"}
          size="xs"
          disabled={loadingAll}
          onClick={() => setSelected(usage)}
        >
          {needsReview ? "Review" : "Inspect"}
        </Button>
        {needsReview && (
          <Button
            variant="outline"
            size="xs"
            disabled={loadingAll}
            onClick={() => setHoldsToRelease([usage])}
          >
            Release hold
          </Button>
        )}
      </div>
    )
  }

  const pageHolds =
    data?.items.filter((usage) => usage.status === "needs_review") ?? []
  const pageChecked = pageHolds.filter((hold) => checked.has(hold.id)).length
  const showReleaseActions =
    applied.status === "needs_review" || applied.status === "all"
  const isDefaultFilter =
    applied.status === "needs_review" && applied.userId === ""
  const reviewOnly = applied.status === "needs_review"

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Credit holds</h2>
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

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2.5 text-sm">
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
          <Button
            size="sm"
            className="h-8"
            onClick={applyFilters}
            disabled={loadingAll}
          >
            Apply
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={resetFilters}
            disabled={
              loadingAll ||
              (statusFilter === "needs_review" && userIdFilter === "")
            }
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
                ? "No unresolved credit holds"
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
            {showReleaseActions && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={
                      pageChecked === 0
                        ? false
                        : pageChecked === pageHolds.length
                          ? true
                          : "indeterminate"
                    }
                    disabled={pageHolds.length === 0}
                    onCheckedChange={(value) =>
                      setHoldsChecked(pageHolds, value === true)
                    }
                  />
                  Select page
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loadingAll || checked.size === 0}
                  onClick={() => setHoldsToRelease([...checked.values()])}
                >
                  Release selected{checked.size > 0 ? ` (${checked.size})` : ""}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loadingAll}
                  onClick={() => void prepareReleaseAll()}
                >
                  {loadingAll ? "Loading holds…" : "Release all matching"}
                </Button>
              </div>
            )}
            <ul
              className="flex flex-col divide-y @3xl/review:hidden"
              aria-label="Usage records"
            >
              {data.items.map((usage) => (
                <li
                  key={usage.id}
                  className="flex min-w-0 flex-col gap-2 py-2.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {selectionCheckbox(usage)}
                      <span
                        title={usage.request_id}
                        className="font-mono text-xs font-medium"
                      >
                        {shortId(usage.request_id)}
                      </span>
                    </div>
                    {!reviewOnly && <UsageStatusBadge status={usage.status} />}
                  </div>

                  {usage.status === "needs_review" && (
                    <p
                      className="line-clamp-2 text-sm wrap-anywhere"
                      title={creditReviewReason(usage.reason)}
                    >
                      {creditReviewReason(usage.reason)}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                    <span
                      title={usage.model_id ?? usage.provider_model_id}
                      className="wrap-anywhere"
                    >
                      {usage.model_id ?? shortId(usage.provider_model_id)}
                    </span>
                    <time dateTime={usage.created_at}>
                      {formatDateTime(usage.created_at)}
                    </time>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex flex-wrap gap-x-3 text-xs tabular-nums">
                      <span>Hold {formatCredits(usage.reserved_credits)}</span>
                      {!reviewOnly && (
                        <span className="text-muted-foreground">
                          Charged{" "}
                          {chargeDisplayedText(
                            usage.status,
                            usage.charged_credits
                          )}
                        </span>
                      )}
                    </p>
                    {rowActions(usage)}
                  </div>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto rounded-lg border @3xl/review:block">
              <Table aria-label="Credit holds">
                <TableHeader>
                  <TableRow>
                    {showReleaseActions && (
                      <TableHead>
                        <span className="sr-only">Select hold</span>
                      </TableHead>
                    )}
                    <TableHead>Request</TableHead>
                    <TableHead>
                      {reviewOnly ? "Review reason" : "Status / review reason"}
                    </TableHead>
                    <TableHead className="text-right">Hold</TableHead>
                    {!reviewOnly && (
                      <TableHead className="text-right">Charged</TableHead>
                    )}
                    <TableHead className="w-px text-right">
                      <span className="sr-only">Action</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((usage) => (
                    <TableRow key={usage.id}>
                      {showReleaseActions && (
                        <TableCell>{selectionCheckbox(usage)}</TableCell>
                      )}
                      <TableCell className="max-w-48 py-1.5">
                        <div className="flex flex-col">
                          <span
                            title={usage.request_id}
                            className="font-mono text-xs font-medium"
                          >
                            {shortId(usage.request_id)}
                          </span>
                          <span
                            title={usage.model_id ?? usage.provider_model_id}
                            className="truncate text-xs text-muted-foreground"
                          >
                            {usage.model_id ?? shortId(usage.provider_model_id)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="min-w-40 whitespace-normal">
                        <div className="flex flex-col items-start gap-1">
                          {!reviewOnly && (
                            <UsageStatusBadge status={usage.status} />
                          )}
                          {usage.status === "needs_review" && (
                            <span
                              className="line-clamp-2 text-xs wrap-anywhere"
                              title={creditReviewReason(usage.reason)}
                            >
                              {creditReviewReason(usage.reason)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCredits(usage.reserved_credits)}
                      </TableCell>
                      {!reviewOnly && (
                        <TableCell className="text-right tabular-nums">
                          {chargeDisplayedText(
                            usage.status,
                            usage.charged_credits
                          )}
                        </TableCell>
                      )}
                      <TableCell className="text-right">
                        {rowActions(usage)}
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
      {holdsToRelease && (
        <ReleaseCreditHoldsDialog
          holds={holdsToRelease}
          onClose={() => setHoldsToRelease(null)}
          onReleased={(ids) => {
            const released = new Set(ids)
            setChecked(
              (previous) =>
                new Map([...previous].filter(([id]) => !released.has(id)))
            )
            setData(null)
            setTick((value) => value + 1)
          }}
        />
      )}
    </div>
  )
}
