import * as React from "react"
import {
  IconArrowUpRight,
  IconFilter,
  IconRefresh,
  IconRoute,
  IconSearch,
  IconServer,
} from "@tabler/icons-react"
import { PageContent } from "@/components/dashboard-shell"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  listCallTraces,
  listMessageTraces,
  type CallTraceFilters,
  type CallsPage,
  type CurrentUser,
  type MessagesPage,
} from "@/lib/auth"
import { formatInt, isCallTraceItem, type TabKey, TraceEmpty } from "./shared"
import {
  CallRow,
  filterFields,
  FilterInput,
  MessageRow,
  TablePagination,
} from "./list-rows"

const PAGE_SIZE = 20

type LoadState<T> = {
  tab: TabKey
  page: number
  tick: number
  requestId: string
  filters: CallTraceFilters
} & ({ data: T } | { data?: undefined; message: string })

function matches(
  value: LoadState<unknown> | null,
  tab: TabKey,
  page: number,
  tick: number,
  requestId: string,
  filters: CallTraceFilters
) {
  return (
    value?.tab === tab &&
    value.page === page &&
    value.tick === tick &&
    value.requestId === requestId &&
    value.filters === filters
  )
}

export function TracesContent({ user }: { user?: CurrentUser } = {}) {
  const [tab, setTab] = React.useState<TabKey>("messages")
  const [reloadTick, setReloadTick] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState("")
  const [result, setResult] = React.useState<LoadState<
    MessagesPage | CallsPage
  > | null>(null)
  const [draftFilters, setDraftFilters] = React.useState<CallTraceFilters>({})
  const [filters, setFilters] = React.useState<CallTraceFilters>({})
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  const searchId = React.useId()
  const statusId = React.useId()

  const requestId = search.trim()

  React.useEffect(() => {
    let cancelled = false
    const request =
      tab === "messages"
        ? listMessageTraces({ page, pageSize: PAGE_SIZE, requestId })
        : listCallTraces({
            page,
            pageSize: PAGE_SIZE,
            filters: { ...filters, request_id: requestId },
          })
    request
      .then((data) => {
        if (!cancelled)
          setResult({
            tab,
            page,
            tick: reloadTick,
            requestId,
            filters,
            data,
          })
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setResult({
            tab,
            page,
            tick: reloadTick,
            requestId,
            filters,
            message:
              error instanceof Error ? error.message : "Unable to load traces.",
          })
      })
    return () => {
      cancelled = true
    }
  }, [tab, page, filters, reloadTick, requestId])

  const current = matches(result, tab, page, reloadTick, requestId, filters)
    ? result!
    : null
  const error =
    current && !current.data && "message" in current ? current.message : null
  const data = current?.data ?? null
  const loading = !data && !error
  const items = data?.items ?? []
  const appliedCount = Object.keys(filters).length

  function resetFilters() {
    setDraftFilters({})
    setFilters({})
    setPage(1)
  }

  return (
    <PageContent>
      <div className="flex min-w-0 flex-col gap-6">
        {/* Title & toolbar */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Request traces
            </h1>
            {user?.role === "superuser" ? (
              <Badge variant="outline">Superuser</Badge>
            ) : null}
          </div>
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => {
              setPage(1)
              setReloadTick((tick) => tick + 1)
            }}
          >
            <IconRefresh
              data-icon="inline-start"
              className={cn(loading && "motion-safe:animate-spin")}
            />
            Refresh
          </Button>
        </div>

        {user && !user.tracing_enabled ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 px-4 py-3 text-xs">
            <p className="text-muted-foreground">
              Usage tracing is currently disabled for your account. New
              inference requests are not being recorded.
            </p>
            <Button asChild variant="outline" size="sm">
              <a href="/dashboard/settings">Enable in Settings</a>
            </Button>
          </div>
        ) : null}

        {/* Traces container */}
        <div className="w-full min-w-0 overflow-hidden rounded-xl border bg-card shadow-xs">
          <Tabs
            value={tab}
            onValueChange={(value) => {
              setTab(value as TabKey)
              setPage(1)
            }}
            className="min-w-0 gap-0"
          >
            {/* Tab header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-2.5">
              <TabsList
                variant="line"
                className="[&>[data-slot=tabs-trigger]:focus-visible]:ring-0"
              >
                <TabsTrigger
                  value="messages"
                  className="flex items-center gap-1.5"
                >
                  <IconRoute className="size-4" />
                  Requests
                </TabsTrigger>
                <TabsTrigger
                  value="calls"
                  className="flex items-center gap-1.5"
                >
                  <IconServer className="size-4" />
                  Provider calls
                </TabsTrigger>
              </TabsList>
              <span className="font-mono text-xs text-muted-foreground">
                {data
                  ? `${formatInt(data.total)} ${tab === "messages" ? "requests recorded" : "matching calls"}`
                  : "Recorded gateway traffic"}
              </span>
            </div>

            {/* Outcomes strip */}
            <div
              className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-muted/10 px-4 py-2.5"
              aria-label="Outcomes on the loaded page"
            >
              <div
                className="flex h-2 min-w-40 flex-1 gap-0.5 overflow-hidden rounded-full"
                role="group"
                aria-label="Outcome visualizer"
              >
                {data?.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={`Inspect ${item.status} ${item.id}`}
                    title={`${item.status} · ${item.id}`}
                    onClick={() => {
                      window.location.assign(
                        isCallTraceItem(item)
                          ? `/dashboard/traces/detail?id=${encodeURIComponent(item.message_trace_id)}&tab=attempts`
                          : `/dashboard/traces/detail?id=${encodeURIComponent(item.id)}`
                      )
                    }}
                    className={cn(
                      "min-w-0 flex-1 transition-opacity hover:opacity-75 focus-visible:outline-2 focus-visible:outline-ring",
                      item.status === "success"
                        ? "bg-emerald-500/80 dark:bg-emerald-400/80"
                        : item.status === "failed" || item.status === "timeout"
                          ? "bg-destructive/80"
                          : "bg-muted-foreground/30"
                    )}
                  />
                ))}
                {!data?.items.length && <div className="w-full bg-muted" />}
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">
                {data
                  ? `${data.items.filter((item) => item.status === "success").length} successful / ${data.items.filter((item) => item.status === "failed" || item.status === "timeout").length} failed`
                  : "Waiting for records"}
              </p>
            </div>

            {/* Filter toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-sm">
                <IconSearch
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <label htmlFor={searchId} className="sr-only">
                  Search by request ID
                </label>
                <Input
                  id={searchId}
                  type="search"
                  placeholder="Search by request ID…"
                  maxLength={255}
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setPage(1)
                  }}
                  className="h-8 text-xs"
                />
              </div>
              {tab === "calls" ? (
                <Button
                  variant="outline"
                  size="sm"
                  aria-expanded={filtersOpen}
                  aria-controls="trace-call-filters"
                  onClick={() => setFiltersOpen(!filtersOpen)}
                  className="h-8 gap-1.5 text-xs"
                >
                  <IconFilter className="size-3.5" />
                  Filters
                  {appliedCount ? (
                    <Badge
                      variant="secondary"
                      className="px-1.5 py-0 text-[10px]"
                    >
                      {appliedCount}
                    </Badge>
                  ) : null}
                </Button>
              ) : (
                <span className="hidden text-xs text-muted-foreground sm:block">
                  Click any row to open the full request details
                </span>
              )}
            </div>

            {tab === "calls" ? (
              <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
                <CollapsibleContent id="trace-call-filters">
                  <form
                    className="flex flex-col gap-4 border-b bg-muted/20 p-4"
                    onSubmit={(event) => {
                      event.preventDefault()
                      const next = Object.fromEntries(
                        Object.entries(draftFilters)
                          .filter(([, value]) => value?.trim())
                          .map(([key, value]) => [key, value.trim()])
                      ) as CallTraceFilters
                      setFilters(next)
                      setPage(1)
                    }}
                  >
                    <div className="flex flex-col gap-1">
                      <h2 className="text-sm font-medium">
                        Filter provider calls
                      </h2>
                    </div>
                    <FieldGroup className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <Field>
                        <FieldLabel htmlFor={statusId}>Status</FieldLabel>
                        <Select
                          value={draftFilters.status ?? "any"}
                          onValueChange={(value) =>
                            setDraftFilters((draft) => ({
                              ...draft,
                              status: value === "any" ? undefined : value,
                            }))
                          }
                        >
                          <SelectTrigger
                            id={statusId}
                            className="h-8 w-full text-xs"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="any">Any status</SelectItem>
                              <SelectItem value="success">Success</SelectItem>
                              <SelectItem value="failed">Failed</SelectItem>
                              <SelectItem value="timeout">Timeout</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                      {filterFields
                        .filter(
                          (f) =>
                            user?.role === "superuser" || f.key !== "user_id"
                        )
                        .map(({ key, label, type }) => (
                          <FilterInput
                            key={key}
                            label={label}
                            type={type}
                            value={draftFilters[key] ?? ""}
                            onChange={(value) =>
                              setDraftFilters((draft) => ({
                                ...draft,
                                [key]: value,
                              }))
                            }
                          />
                        ))}
                    </FieldGroup>
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" size="sm" className="h-7 text-xs">
                        Apply filters
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={resetFilters}
                        className="h-7 text-xs"
                      >
                        Reset filters
                      </Button>
                    </div>
                  </form>
                </CollapsibleContent>
              </Collapsible>
            ) : null}

            {/* Table view */}
            <TabsContent value={tab} className="mt-0" aria-busy={loading}>
              {error ? (
                <TraceEmpty
                  title="Unable to load traces"
                  description={error}
                  action={
                    <Button
                      variant="outline"
                      onClick={() => setReloadTick((tick) => tick + 1)}
                    >
                      Try again
                    </Button>
                  }
                  error
                />
              ) : loading ? (
                <div
                  className="flex flex-col gap-4 p-5"
                  role="status"
                  aria-label="Loading traces"
                >
                  {Array.from({ length: 8 }, (_, index) => (
                    <div key={index} className="flex items-center gap-6">
                      <Skeleton className="h-8 w-28" />
                      <Skeleton className="h-8 w-24" />
                      <Skeleton className="h-8 flex-1" />
                      <Skeleton className="h-8 w-20" />
                      <Skeleton className="h-8 w-16" />
                    </div>
                  ))}
                </div>
              ) : !items.length ? (
                <TraceEmpty
                  title={
                    requestId
                      ? "No traces match this request ID"
                      : appliedCount && tab === "calls"
                        ? "No calls match these filters"
                        : "No traces recorded yet"
                  }
                  description={
                    requestId
                      ? "Check the full request ID and any active filters."
                      : appliedCount && tab === "calls"
                        ? "Adjust your filters or clear them to see all recorded provider calls."
                        : "Enable tracing for a user in User Management, then send a request through the gateway to inspect it here."
                  }
                  action={
                    requestId ? (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setSearch("")
                          setPage(1)
                        }}
                      >
                        Clear search
                      </Button>
                    ) : appliedCount && tab === "calls" ? (
                      <Button variant="outline" onClick={resetFilters}>
                        Clear filters
                      </Button>
                    ) : (
                      <Button asChild variant="outline">
                        <a href="/dashboard/users">
                          Manage user tracing
                          <IconArrowUpRight data-icon="inline-end" />
                        </a>
                      </Button>
                    )
                  }
                />
              ) : (
                <div className="w-full overflow-x-auto">
                  <Table className="w-full">
                    <TableHeader className="bg-muted/40">
                      {tab === "messages" ? (
                        <TableRow>
                          <TableHead className="min-w-[150px] pl-4">
                            Time
                          </TableHead>
                          <TableHead className="min-w-[130px]">
                            Request ID
                          </TableHead>
                          <TableHead className="min-w-[180px]">Model</TableHead>
                          <TableHead className="min-w-[110px]">
                            Status
                          </TableHead>
                          <TableHead className="min-w-[100px] text-right">
                            Latency
                          </TableHead>
                          <TableHead className="min-w-[140px]">
                            Tokens (in / out)
                          </TableHead>
                          <TableHead className="min-w-[120px]">
                            Attempts
                          </TableHead>
                          <TableHead className="min-w-[90px] pr-4 text-right">
                            Actions
                          </TableHead>
                        </TableRow>
                      ) : (
                        <TableRow>
                          <TableHead className="min-w-[150px] pl-4">
                            Time
                          </TableHead>
                          <TableHead className="min-w-[130px]">
                            Call ID
                          </TableHead>
                          <TableHead className="min-w-[140px]">
                            Provider
                          </TableHead>
                          <TableHead className="min-w-[160px]">
                            Provider Model
                          </TableHead>
                          <TableHead className="min-w-[140px]">
                            Gateway Model
                          </TableHead>
                          <TableHead className="min-w-[110px]">
                            Status
                          </TableHead>
                          <TableHead className="min-w-[100px] text-right">
                            Latency
                          </TableHead>
                          <TableHead className="min-w-[140px]">
                            Tokens
                          </TableHead>
                          <TableHead className="min-w-[90px] pr-4 text-right">
                            Actions
                          </TableHead>
                        </TableRow>
                      )}
                    </TableHeader>
                    <TableBody>
                      {items.map((item) =>
                        isCallTraceItem(item) ? (
                          <CallRow key={item.id} call={item} />
                        ) : (
                          <MessageRow key={item.id} item={item} />
                        )
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}

              {data && data.total > 0 ? (
                <TablePagination
                  page={page}
                  pageSize={data.page_size}
                  total={data.total}
                  onPageChange={(next) => setPage(next)}
                />
              ) : null}
            </TabsContent>
          </Tabs>
        </div>

        <p className="max-w-3xl text-xs leading-5 text-muted-foreground">
          Tracing is opt-in per user. Payloads are sanitized before storage. For
          billing, see{" "}
          <a href="/dashboard/credits" className="underline underline-offset-4">
            Credits
          </a>
          .
        </p>
      </div>
    </PageContent>
  )
}
