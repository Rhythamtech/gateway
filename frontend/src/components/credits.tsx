import * as React from "react"
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  Copy,
  RefreshCw,
  Wallet,
  LockKeyhole,
  ReceiptText,
  Search,
} from "lucide-react"
import { toast } from "sonner"
import {
  getMyCredits,
  listMyCreditHistory,
  listMyCreditUsage,
  type CreditBalance,
  type CreditEntry,
  type CreditUsage,
} from "@/lib/auth"
import {
  chargeDisplayedText,
  formatCredits,
  formatTokenCount,
  isZeroCredits,
} from "@/lib/credits"
import { formatTimestampInDeviceZone, parseApiTimestamp } from "@/lib/datetime"
import {
  UsageDetailDrawer,
  UsageStatusBadge,
} from "@/components/credit-drawers"
import { CreditPaginationBar } from "@/components/credit-tracking"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const PAGE_SIZE = 20
const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-4)}`
const timestamp = (value: string) => {
  const date = parseApiTimestamp(value)
  return date ? formatTimestampInDeviceZone(date) : value
}
type LedgerPage<T> = {
  page: number
  tick: number
  items: T[]
  total: number
  at: Date
}

export function CreditsContent() {
  const [balance, setBalance] = React.useState<CreditBalance | null>(null)
  const [balanceError, setBalanceError] = React.useState<string | null>(null)
  const [balanceLoading, setBalanceLoading] = React.useState(true)
  const [balanceAt, setBalanceAt] = React.useState<Date | null>(null)
  const [tick, setTick] = React.useState(0)
  const [activeTab, setActiveTab] = React.useState("usage")
  const [usagePage, setUsagePage] = React.useState(1)
  const [historyPage, setHistoryPage] = React.useState(1)
  const [usage, setUsage] = React.useState<LedgerPage<CreditUsage> | null>(null)
  const [history, setHistory] = React.useState<LedgerPage<CreditEntry> | null>(
    null
  )
  const [failure, setFailure] = React.useState<{
    key: string
    message: string
  } | null>(null)
  const [selectedUsage, setSelectedUsage] = React.useState<CreditUsage | null>(
    null
  )
  const [search, setSearch] = React.useState("")
  const queryKey = `${activeTab}:${activeTab === "usage" ? usagePage : historyPage}:${tick}`
  React.useEffect(() => {
    let cancelled = false
    getMyCredits()
      .then((value) => {
        if (!cancelled) {
          setBalance(value)
          setBalanceAt(new Date())
          setBalanceError(null)
          setBalanceLoading(false)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setBalanceError(
            error instanceof Error
              ? error.message
              : "Balance could not be loaded."
          )
          setBalanceLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [tick])
  React.useEffect(() => {
    let cancelled = false
    const page = activeTab === "usage" ? usagePage : historyPage
    if (activeTab === "usage") {
      listMyCreditUsage({ page, pageSize: PAGE_SIZE })
        .then((value) => {
          if (!cancelled) {
            setUsage({
              page,
              tick,
              items: value.items,
              total: value.total,
              at: new Date(),
            })
            const last = Math.max(1, Math.ceil(value.total / PAGE_SIZE))
            if (page > last) setUsagePage(last)
          }
        })
        .catch((error: unknown) => {
          if (!cancelled)
            setFailure({
              key: queryKey,
              message:
                error instanceof Error
                  ? error.message
                  : "Charges could not be loaded.",
            })
        })
    } else {
      listMyCreditHistory({ page, pageSize: PAGE_SIZE })
        .then((value) => {
          if (!cancelled) {
            setHistory({
              page,
              tick,
              items: value.items,
              total: value.total,
              at: new Date(),
            })
            const last = Math.max(1, Math.ceil(value.total / PAGE_SIZE))
            if (page > last) setHistoryPage(last)
          }
        })
        .catch((error: unknown) => {
          if (!cancelled)
            setFailure({
              key: queryKey,
              message:
                error instanceof Error
                  ? error.message
                  : "History could not be loaded.",
            })
        })
    }
    return () => {
      cancelled = true
    }
  }, [activeTab, usagePage, historyPage, tick, queryKey])
  const usageReady = usage?.page === usagePage && usage.tick === tick
  const historyReady = history?.page === historyPage && history.tick === tick
  const ready = activeTab === "usage" ? usageReady : historyReady
  const error = !ready && failure?.key === queryKey ? failure.message : null
  const total = activeTab === "usage" ? usage?.total : history?.total
  const query = search.trim().toLowerCase()
  const usageItems = usageReady
    ? usage.items.filter((item) =>
        [item.request_id, item.provider_model_id, item.status, item.id].some(
          (value) => value.toLowerCase().includes(query)
        )
      )
    : []
  const historyItems = historyReady
    ? history.items.filter((item) =>
        [item.reason, item.id, item.usage_id ?? "", item.credits].some(
          (value) => value.toLowerCase().includes(query)
        )
      )
    : []
  function refresh() {
    setBalanceLoading(true)
    setTick((value) => value + 1)
  }
  return (
    <div className="flex min-w-0 flex-col gap-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
            <Wallet className="size-4" /> Credit account
          </p>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Balance & charges
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Your inference allowance and every credit movement, in one place.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={refresh}
          disabled={balanceLoading || (!ready && !error)}
        >
          <RefreshCw data-icon="inline-start" />
          Refresh account
        </Button>
      </header>
      <section
        aria-label="Account balance"
        className="overflow-hidden rounded-2xl border bg-card"
      >
        <div className="flex min-w-0 flex-col justify-between gap-6 p-6 sm:p-8">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium">
              <span className="size-2 rounded-full bg-primary" />
              Available to spend
            </p>
            {balance ? (
              <p
                title={balance.available_credits}
                className="mt-4 text-4xl font-semibold tracking-tighter break-all tabular-nums sm:text-5xl"
              >
                {formatCredits(balance.available_credits)}{" "}
                <span className="text-base font-normal tracking-normal text-muted-foreground">
                  credits
                </span>
              </p>
            ) : balanceError ? (
              <p className="mt-4 text-2xl font-medium">Unavailable</p>
            ) : (
              <Skeleton className="mt-4 h-12 w-3/4" />
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Personal account</span>
            <span role="status">
              {balanceLoading
                ? "Refreshing balance…"
                : balanceAt
                  ? `Balance updated ${balanceAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : ""}
            </span>
          </div>
        </div>
        {balance && !isZeroCredits(balance.reserved_credits) && (
          <div className="flex flex-col gap-2 border-t bg-muted/25 px-6 py-4 sm:px-8">
            <dl className="flex flex-wrap items-center justify-between gap-2">
              <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                <LockKeyhole className="size-3.5" />
                Reserved for requests
              </dt>
              <dd className="font-medium tabular-nums">
                {formatCredits(balance.reserved_credits)}
              </dd>
            </dl>
            <p className="text-xs leading-5 text-muted-foreground">
              These credits are temporarily held. Unused credits become
              available when the hold is settled or released.
            </p>
          </div>
        )}
      </section>
      {balanceError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-4 text-sm"
        >
          <p>
            {balanceError}
            {balance ? " Displaying the last loaded balance." : ""}
          </p>
          <Button variant="outline" size="sm" onClick={refresh}>
            Retry balance
          </Button>
        </div>
      )}
      {balance && isZeroCredits(balance.available_credits) && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4"
        >
          <LockKeyhole className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="text-sm font-medium">
              No credits available for new requests
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              An administrator can add credits. Any active holds stay reserved
              until the request settles or is released.
            </p>
          </div>
        </div>
      )}
      <section className="@container/ledger min-w-0 overflow-hidden rounded-xl border">
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            setActiveTab(value)
            setSearch("")
          }}
          className="gap-0"
        >
          <div className="flex flex-wrap items-center justify-between gap-4 border-b bg-muted/20 px-4 pt-3 sm:px-6">
            <TabsList variant="line">
              <TabsTrigger value="usage">
                <ReceiptText />
                Inference charges
              </TabsTrigger>
              <TabsTrigger value="history">
                <BookOpen />
                Balance history
              </TabsTrigger>
            </TabsList>
            <span className="pb-3 text-xs text-muted-foreground">
              {ready
                ? `${total?.toLocaleString()} ${activeTab === "usage" ? "usage records" : "ledger entries"}`
                : "Loading ledger…"}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 sm:px-6">
            <div>
              <h3 className="text-sm font-semibold">
                {activeTab === "usage" ? "Request charges" : "Credit movements"}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {activeTab === "usage"
                  ? "Recorded rates. Actual usage. Final settlement."
                  : "Additions and debits with the balance after each entry."}
              </p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" />
              <Input
                aria-label="Search this ledger page"
                type="search"
                placeholder="Search this page…"
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>
          {error ? (
            <div role="alert" className="flex flex-col items-start gap-3 p-6">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={refresh}>
                Try again
              </Button>
            </div>
          ) : !ready ? (
            <div
              className="flex flex-col gap-4 p-6"
              role="status"
              aria-label="Loading ledger"
            >
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <>
              <TabsContent value="usage" className="mt-0">
                <Charges items={usageItems} onOpen={setSelectedUsage} />
                {!usageItems.length && (
                  <LedgerEmpty
                    filtered={Boolean(query)}
                    history={false}
                    onClear={() => setSearch("")}
                  />
                )}
              </TabsContent>
              <TabsContent value="history" className="mt-0">
                <History items={historyItems} />
                {!historyItems.length && (
                  <LedgerEmpty
                    filtered={Boolean(query)}
                    history
                    onClear={() => setSearch("")}
                  />
                )}
              </TabsContent>
              <div className="border-t px-4 py-3 sm:px-6">
                <CreditPaginationBar
                  page={activeTab === "usage" ? usagePage : historyPage}
                  pageSize={PAGE_SIZE}
                  total={total ?? 0}
                  onPage={(page) => {
                    setSearch("")
                    if (activeTab === "usage") setUsagePage(page)
                    else setHistoryPage(page)
                  }}
                />
              </div>
            </>
          )}
        </Tabs>
      </section>
      <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <p>Credits are gateway usage units. Holds are not finalized charges.</p>
        <a
          href="/dashboard/playground"
          className="flex items-center gap-1 font-medium text-foreground hover:underline"
        >
          Open Playground
          <ArrowUpRight className="size-3.5" />
        </a>
      </footer>
      {selectedUsage && (
        <UsageDetailDrawer
          usage={selectedUsage}
          onClose={() => setSelectedUsage(null)}
        />
      )}
    </div>
  )
}
async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success("Identifier copied.")
  } catch {
    toast.error("Could not copy. Select the identifier instead.")
  }
}
function Charges({
  items,
  onOpen,
}: {
  items: CreditUsage[]
  onOpen: (item: CreditUsage) => void
}) {
  if (!items.length) return null
  return (
    <>
      <div className="hidden @min-[760px]/ledger:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Request / date</TableHead>
              <TableHead>Provider model ID</TableHead>
              <TableHead className="text-right">Input</TableHead>
              <TableHead className="text-right">Output</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-6 text-right">
                Charge · credits
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="py-4 pl-6">
                  <Button
                    variant="link"
                    className="h-auto p-0 font-mono text-xs"
                    onClick={() => onOpen(item)}
                  >
                    {short(item.request_id)}
                  </Button>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {timestamp(item.created_at)}
                  </p>
                </TableCell>
                <TableCell>
                  <span
                    title={item.provider_model_id}
                    className="font-mono text-xs text-muted-foreground"
                  >
                    {short(item.provider_model_id)}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatTokenCount(item.input_tokens)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatTokenCount(item.output_tokens)}
                </TableCell>
                <TableCell>
                  <UsageStatusBadge status={item.status} />
                </TableCell>
                <TableCell className="pr-6 text-right">
                  <Button
                    variant="ghost"
                    onClick={() => onOpen(item)}
                    className="font-semibold tabular-nums"
                  >
                    {chargeDisplayedText(item.status, item.charged_credits)}
                    <ArrowUpRight data-icon="inline-end" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul
        aria-label="Inference charges"
        className="divide-y @min-[760px]/ledger:hidden"
      >
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {timestamp(item.created_at)}
              </span>
              <UsageStatusBadge status={item.status} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-xs" title={item.request_id}>
                {short(item.request_id)}
              </span>
              <span className="font-semibold tabular-nums">
                {chargeDisplayedText(item.status, item.charged_credits)}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  credits
                </span>
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <dt className="text-muted-foreground">Input tokens</dt>
                <dd className="mt-1 tabular-nums">
                  {formatTokenCount(item.input_tokens)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Output tokens</dt>
                <dd className="mt-1 tabular-nums">
                  {formatTokenCount(item.output_tokens)}
                </dd>
              </div>
            </dl>
            <Button variant="outline" size="sm" onClick={() => onOpen(item)}>
              View charge
              <ArrowUpRight data-icon="inline-end" />
            </Button>
          </li>
        ))}
      </ul>
    </>
  )
}
function History({ items }: { items: CreditEntry[] }) {
  if (!items.length) return null
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4 sm:pl-6">Entry / date</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead className="text-right">Movement</TableHead>
            <TableHead className="pr-4 text-right sm:pr-6">
              Balance after
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const debit = item.credits.startsWith("-")
            return (
              <TableRow key={item.id}>
                <TableCell className="py-4 pl-4 sm:pl-6">
                  <div className="flex items-center gap-2">
                    {debit ? (
                      <ArrowUpRight className="size-4 text-muted-foreground" />
                    ) : (
                      <ArrowDownLeft className="size-4 text-muted-foreground" />
                    )}
                    <span className="font-medium">
                      {debit ? "Usage debit" : "Credit addition"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {timestamp(item.created_at)}
                  </p>
                </TableCell>
                <TableCell className="max-w-72 whitespace-normal">
                  <p className="text-sm break-words">{item.reason || "—"}</p>
                  {item.usage_id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-1 h-auto px-0 font-mono text-xs text-muted-foreground"
                      onClick={() => void copy(item.usage_id!)}
                      aria-label={`Copy usage ID ${item.usage_id}`}
                    >
                      {short(item.usage_id)}
                      <Copy data-icon="inline-end" />
                    </Button>
                  )}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {debit ? "" : "+"}
                  {formatCredits(item.credits)}
                </TableCell>
                <TableCell className="pr-4 text-right tabular-nums sm:pr-6">
                  {formatCredits(item.remaining_credits)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
function LedgerEmpty({
  filtered,
  history,
  onClear,
}: {
  filtered: boolean
  history: boolean
  onClear: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <ReceiptText className="size-7 text-muted-foreground" />
      <h3 className="text-sm font-medium">
        {filtered
          ? "No matching records on this page"
          : history
            ? "No credit movements yet"
            : "No inference charges yet"}
      </h3>
      <p className="max-w-sm text-xs leading-5 text-muted-foreground">
        {filtered
          ? "Search applies to the current page. Clear it to see all loaded records."
          : history
            ? "Credit additions and finalized request debits will appear here."
            : "Run a request in the Playground to see its reservation and charge."}
      </p>
      {filtered ? (
        <Button variant="outline" size="sm" onClick={onClear}>
          Clear search
        </Button>
      ) : !history ? (
        <Button asChild variant="outline" size="sm">
          <a href="/dashboard/playground">Open Playground</a>
        </Button>
      ) : null}
    </div>
  )
}
