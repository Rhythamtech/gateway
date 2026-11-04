import * as React from "react"
import {
  getUserCredits,
  listUserCreditHistory,
  type CreditBalance,
  type CreditEntry,
  type CreditUsage,
} from "@/lib/auth"
import {
  chargeDisplayedText,
  formatCredits,
  isZeroCredits,
} from "@/lib/credits"
import { formatTimestampInDeviceZone, parseApiTimestamp } from "@/lib/datetime"
import { useIsMobile } from "@/hooks/use-mobile"
import { UsageStatusBadge } from "@/components/credit-drawers"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export type BalanceState =
  | { phase: "loading" }
  | { phase: "error"; error: string }
  | { phase: "ready"; balance: CreditBalance }

export type UsageState =
  | { phase: "loading" }
  | { phase: "error"; error: string }
  | { phase: "ready"; items: CreditUsage[] }

function formatDateTime(value: string): string {
  const date = parseApiTimestamp(value)
  return date === null ? value : formatTimestampInDeviceZone(date)
}

function shortModelLabel(value: string): string {
  return `${value.slice(0, 8)}…`
}

function tokensLine(usage: CreditUsage): string {
  const input =
    usage.input_tokens === null
      ? "Not reported"
      : usage.input_tokens.toLocaleString("en-US")
  const output =
    usage.output_tokens === null
      ? "Not reported"
      : usage.output_tokens.toLocaleString("en-US")
  return `${input} in · ${output} out`
}

export function BalanceCard({
  state,
  onRetry,
  viewAllHref,
}: {
  state: BalanceState
  onRetry: () => void
  viewAllHref?: string
}) {
  const ready = state.phase === "ready"

  return (
    <Card>
      <CardHeader>
        <CardDescription>Available credits</CardDescription>
        {ready && viewAllHref ? (
          <CardAction>
            <Button asChild variant="outline" size="sm">
              <a href={viewAllHref}>View credits</a>
            </Button>
          </CardAction>
        ) : null}
        {ready ? (
          <CardTitle className="text-[32px] leading-10 font-semibold tabular-nums md:text-[40px] md:leading-12">
            {formatCredits(state.balance.available_credits)}
          </CardTitle>
        ) : (
          <Skeleton className="mt-2 h-10 w-48" />
        )}
      </CardHeader>
      {ready ? (
        <CardContent className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
            <span className="flex items-baseline gap-2">
              <span className="text-muted-foreground">In use</span>
              <span className="font-medium tabular-nums">
                {formatCredits(state.balance.reserved_credits)}
              </span>
            </span>
            <Separator
              orientation="vertical"
              className="hidden h-4 self-center sm:block"
            />
            <span className="flex items-baseline gap-2">
              <span className="text-muted-foreground">Remaining</span>
              <span className="font-medium tabular-nums">
                {formatCredits(state.balance.remaining_credits)}
              </span>
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            In use = credits temporarily held by unfinished requests. Available
            = remaining minus in use. A request reserves its full maximum
            allowance before dispatch, so a hold can exceed the final charge;
            the difference is released when the request settles.
          </p>
          {isZeroCredits(state.balance.available_credits) ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              No credits available yet. An administrator adds credits from the
              Users page; requests are rejected until the balance is funded.
            </p>
          ) : null}
        </CardContent>
      ) : (
        <CardContent className="flex flex-col items-start gap-2">
          {state.phase === "loading" ? (
            <Skeleton className="h-4 w-64" />
          ) : (
            <>
              <p className="text-sm text-destructive">{state.error}</p>
              <Button variant="outline" size="sm" onClick={onRetry}>
                Try again
              </Button>
            </>
          )}
        </CardContent>
      )}
    </Card>
  )
}

export function UsageRecords({
  items,
  onOpenDetails,
}: {
  items: CreditUsage[]
  onOpenDetails?: (usage: CreditUsage) => void
}) {
  return (
    <div className="@container/recent min-w-0">
      <ul
        className="flex flex-col divide-y @3xl/recent:hidden"
        aria-label="Request usage"
      >
        {items.map((usage) => (
          <li key={usage.id} className="flex min-w-0 flex-col gap-1 py-3.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">
                {formatDateTime(usage.created_at)}
              </span>
              <UsageStatusBadge status={usage.status} />
            </div>
            <div className="flex min-w-0 items-baseline justify-between gap-3">
              <span
                title={usage.provider_model_id}
                className="min-w-0 truncate font-mono text-xs text-muted-foreground"
              >
                {shortModelLabel(usage.provider_model_id)}
              </span>
              <span className="shrink-0 text-sm font-medium tabular-nums">
                {chargeDisplayedText(usage.status, usage.charged_credits)}
              </span>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {tokensLine(usage)}
            </span>
            {onOpenDetails ? (
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => onOpenDetails(usage)}
              >
                Details
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto @3xl/recent:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Provider model ID</TableHead>
              <TableHead>Tokens</TableHead>
              <TableHead>Charged</TableHead>
              <TableHead>Status</TableHead>
              {onOpenDetails ? (
                <TableHead className="sr-only">Details</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((usage) => (
              <TableRow key={usage.id}>
                <TableCell className="whitespace-nowrap">
                  {formatDateTime(usage.created_at)}
                </TableCell>
                <TableCell
                  title={usage.provider_model_id}
                  className="max-w-56 truncate font-mono text-xs"
                >
                  {shortModelLabel(usage.provider_model_id)}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {tokensLine(usage)}
                </TableCell>
                <TableCell className="font-medium tabular-nums">
                  {chargeDisplayedText(usage.status, usage.charged_credits)}
                </TableCell>
                <TableCell>
                  <UsageStatusBadge status={usage.status} />
                </TableCell>
                {onOpenDetails ? (
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onOpenDetails(usage)}
                    >
                      Details
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export function UsageRecordsCard({
  state,
  onRetry,
  onOpenDetails,
}: {
  state: UsageState
  onRetry: () => void
  onOpenDetails?: (usage: CreditUsage) => void
}) {
  const ready = state.phase === "ready"
  const empty = ready && state.items.length === 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent requests</CardTitle>
        <CardDescription>
          Your latest charged requests, newest first.
        </CardDescription>
        {ready && !empty ? (
          <CardAction>
            <Button asChild variant="ghost" size="sm">
              <a href="/dashboard/credits">View all</a>
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="min-w-0">
        {state.phase === "loading" ? (
          <div className="flex flex-col gap-3.5 py-2">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-4 w-52" />
          </div>
        ) : state.phase === "error" ? (
          <div className="flex flex-col items-start gap-2 py-2">
            <p className="text-sm text-destructive">{state.error}</p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : empty ? (
          <div className="flex flex-col items-start gap-1.5 py-4">
            <p className="text-sm font-medium">No requests recorded yet.</p>
            <p className="text-sm text-muted-foreground">
              Run a request in the Playground to see charges land here.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-1">
              <a href="/dashboard/playground">Open Playground</a>
            </Button>
          </div>
        ) : (
          <UsageRecords items={state.items} onOpenDetails={onOpenDetails} />
        )}
      </CardContent>
    </Card>
  )
}

function entryDirection(entry: CreditEntry): string {
  if (isZeroCredits(entry.credits)) return "Zero entry"
  return entry.credits.trim().startsWith("-") ? "Used" : "Added"
}

function signedCredits(entry: CreditEntry): string {
  if (isZeroCredits(entry.credits)) return "0"
  if (entry.credits.trim().startsWith("-")) return formatCredits(entry.credits)
  return `+${formatCredits(entry.credits)}`
}

function DirectionBadge({ entry }: { entry: CreditEntry }) {
  const direction = entryDirection(entry)
  if (direction === "Added") {
    return (
      <Badge
        variant="outline"
        className="px-1.5 text-green-700 dark:text-green-400"
      >
        {direction}
      </Badge>
    )
  }
  if (direction === "Zero entry") {
    return (
      <Badge variant="outline" className="px-1.5 text-muted-foreground">
        {direction}
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="px-1.5">
      {direction}
    </Badge>
  )
}

export function CreditPaginationBar({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="order-2 text-xs text-muted-foreground tabular-nums sm:order-1">
        Showing {from}–{to} of {total.toLocaleString("en-US")}
      </p>
      <div className="order-1 flex items-center gap-3 sm:order-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

export function HistoryRecords({ items }: { items: CreditEntry[] }) {
  return (
    <div className="min-w-0">
      <ul
        className="flex flex-col divide-y @3xl/credits:hidden"
        aria-label="Credit history"
      >
        {items.map((entry) => (
          <li key={entry.id} className="flex min-w-0 flex-col gap-1 py-3.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">
                {formatDateTime(entry.created_at)}
              </span>
              <DirectionBadge entry={entry} />
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium tabular-nums">
                {signedCredits(entry)}
              </span>
              <span className="text-xs text-muted-foreground">
                Balance after{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {formatCredits(entry.remaining_credits)}
                </span>
              </span>
            </div>
            <p className="text-xs text-muted-foreground" title={entry.reason}>
              {entry.reason}
            </p>
            {entry.usage_id ? (
              <span
                title={entry.usage_id}
                className="font-mono text-xs text-muted-foreground"
              >
                Linked request {shortModelLabel(entry.usage_id)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto @3xl/credits:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead>Credits</TableHead>
              <TableHead>Balance after</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="whitespace-nowrap">
                  {formatDateTime(entry.created_at)}
                </TableCell>
                <TableCell>
                  <DirectionBadge entry={entry} />
                </TableCell>
                <TableCell className="font-medium tabular-nums">
                  {signedCredits(entry)}
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatCredits(entry.remaining_credits)}
                </TableCell>
                <TableCell className="max-w-72">
                  <span className="line-clamp-2" title={entry.reason}>
                    {entry.reason}
                  </span>
                  {entry.usage_id ? (
                    <span
                      title={entry.usage_id}
                      className="block font-mono text-xs text-muted-foreground"
                    >
                      Linked request {shortModelLabel(entry.usage_id)}
                    </span>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

const HISTORY_PAGE_SIZE = 20

export function UserCreditsDrawer({
  user,
  onClose,
  onAddCredits,
}: {
  user: { id: string; email: string }
  onClose: () => void
  onAddCredits: () => void
}) {
  const isMobile = useIsMobile()
  const [balance, setBalance] = React.useState<CreditBalance | null>(null)
  const [balanceError, setBalanceError] = React.useState<string | null>(null)
  const [balanceTick, setBalanceTick] = React.useState(0)
  const [historyPage, setHistoryPage] = React.useState(1)
  const [historyData, setHistoryData] = React.useState<{
    items: CreditEntry[]
    total: number
  } | null>(null)
  const [historyError, setHistoryError] = React.useState<string | null>(null)
  const [historyTick, setHistoryTick] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    getUserCredits(user.id)
      .then((result) => {
        if (cancelled) return
        setBalance(result)
        setBalanceError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setBalanceError(
          error instanceof Error
            ? error.message
            : "Unable to load this user's credits."
        )
      })
    return () => {
      cancelled = true
    }
  }, [user.id, balanceTick])

  React.useEffect(() => {
    let cancelled = false
    listUserCreditHistory(user.id, {
      page: historyPage,
      pageSize: HISTORY_PAGE_SIZE,
    })
      .then((result) => {
        if (cancelled) return
        setHistoryData({ items: result.items, total: result.total })
        setHistoryError(null)
        const lastPage = Math.max(1, Math.ceil(result.total / result.page_size))
        if (result.items.length === 0 && historyPage > lastPage)
          setHistoryPage(lastPage)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setHistoryError(
          error instanceof Error
            ? error.message
            : "Unable to load credit history."
        )
      })
    return () => {
      cancelled = true
    }
  }, [user.id, historyPage, historyTick])

  return (
    <Drawer
      direction={isMobile ? "bottom" : "right"}
      open={true}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DrawerContent className="sm:max-w-lg">
        <DrawerHeader className="shrink-0 gap-1 border-b">
          <DrawerTitle>Credits</DrawerTitle>
          <DrawerDescription>{user.email}</DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-5 p-4 md:p-6">
            {balanceError !== null ? (
              <div className="flex flex-col items-start gap-2">
                <p className="text-sm text-destructive">{balanceError}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBalanceTick((tick) => tick + 1)}
                >
                  Try again
                </Button>
              </div>
            ) : (
              <section className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm text-muted-foreground">
                      Available credits
                    </span>
                    {balance ? (
                      <span className="text-3xl font-semibold tabular-nums">
                        {formatCredits(balance.available_credits)}
                      </span>
                    ) : (
                      <Skeleton className="mt-1 h-8 w-40" />
                    )}
                  </div>
                  <Button size="sm" onClick={onAddCredits}>
                    Add credits
                  </Button>
                </div>
                {balance ? (
                  <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
                    <span className="flex items-baseline gap-2">
                      <span className="text-muted-foreground">In use</span>
                      <span className="font-medium tabular-nums">
                        {formatCredits(balance.reserved_credits)}
                      </span>
                    </span>
                    <Separator
                      orientation="vertical"
                      className="hidden h-4 self-center sm:block"
                    />
                    <span className="flex items-baseline gap-2">
                      <span className="text-muted-foreground">Remaining</span>
                      <span className="font-medium tabular-nums">
                        {formatCredits(balance.remaining_credits)}
                      </span>
                    </span>
                  </div>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  In use = credits temporarily held by unfinished requests.
                  Available = remaining minus in use. A request reserves its
                  full maximum allowance before dispatch, so a hold can exceed
                  the final charge; the difference is released when the request
                  settles.
                </p>
                {balance && isZeroCredits(balance.available_credits) ? (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Requests from this user are rejected until the balance is
                    funded.
                  </p>
                ) : null}
              </section>
            )}

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Credit history</h3>
              {historyError !== null ? (
                <div className="flex flex-col items-start gap-2 py-2">
                  <p className="text-sm text-destructive">{historyError}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setHistoryTick((tick) => tick + 1)}
                  >
                    Try again
                  </Button>
                </div>
              ) : historyData === null ? (
                <div className="flex flex-col gap-3.5 py-2">
                  <Skeleton className="h-4 w-56" />
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-4 w-52" />
                </div>
              ) : historyData.items.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  No credit history yet for this user.
                </p>
              ) : (
                <div className="@container/credits flex flex-col gap-4">
                  <HistoryRecords items={historyData.items} />
                  <CreditPaginationBar
                    page={historyPage}
                    pageSize={HISTORY_PAGE_SIZE}
                    total={historyData.total}
                    onPage={setHistoryPage}
                  />
                </div>
              )}
            </section>
          </div>
        </div>
        <DrawerFooter className="border-t pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <DrawerClose asChild>
            <Button variant="outline">Close</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
