import * as React from "react"
import {
  IconArrowLeft,
  IconArrowUpRight,
  IconBan,
  IconCheck,
  IconChevronRight,
  IconCircleCheckFilled,
  IconClock,
  IconCode,
  IconCopy,
  IconFilter,
  IconRefresh,
  IconRoute,
  IconSearch,
  IconX,
} from "@tabler/icons-react"
import { toast } from "sonner"
import { PageContent } from "@/components/dashboard-shell"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import {
  getMessageTrace,
  listCallTraces,
  listMessageTraces,
  type CallTraceFilters,
  type CallTraceItem,
  type CallsPage,
  type CurrentUser,
  type MessageTraceDetail,
  type MessageTraceItem,
  type MessagesPage,
} from "@/lib/auth"
import { formatTimestampInDeviceZone, parseApiTimestamp } from "@/lib/datetime"
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
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
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const PAGE_SIZE = 20
type TabKey = "messages" | "calls"

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—"
  const date = parseApiTimestamp(value)
  return date === null ? value : formatTimestampInDeviceZone(date)
}
function formatInt(value: number | null | undefined) {
  return value == null ? "—" : value.toLocaleString("en-US")
}
function formatMs(value: number | null) {
  if (value === null) return "—"
  if (value < 1000) return `${value.toLocaleString("en-US")} ms`
  if (value < 60000) return `${(value / 1000).toFixed(2)} s`
  const seconds = Math.round(value / 1000)
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
function shortId(value: string | null | undefined) {
  if (!value) return "—"
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value
}
function requestModel(request: Record<string, unknown> | null) {
  return typeof request?.model === "string" ? request.model : "Inbound request"
}
function TraceStatusBadge({ status }: { status: string }) {
  const Icon =
    status === "success"
      ? IconCircleCheckFilled
      : status === "failed"
        ? IconBan
        : IconClock
  return (
    <Badge
      variant={
        status === "failed" || status === "timeout"
          ? "destructive"
          : "secondary"
      }
    >
      <Icon />
      {status === "success"
        ? "Success"
        : status === "failed"
          ? "Failed"
          : status === "timeout"
            ? "Timeout"
            : status === "pending"
              ? "Pending"
              : status}
    </Badge>
  )
}
function CopyButton({
  value,
  label = "Copy",
}: {
  value: string
  label?: string
}) {
  const [copied, setCopied] = React.useState(false)
  React.useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1800)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
        } catch {
          toast.error("Unable to copy. Select and copy the text instead.")
        }
      }}
    >
      {copied ? (
        <IconCheck data-icon="inline-start" />
      ) : (
        <IconCopy data-icon="inline-start" />
      )}
      {copied ? "Copied" : label}
    </Button>
  )
}
function RequestBlock({
  request,
}: {
  request: Record<string, unknown> | null
}) {
  const payload =
    request && Object.keys(request).length
      ? JSON.stringify(request, null, 2)
      : null
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          <IconCode className="size-4 text-muted-foreground" /> Request JSON
        </span>
        {payload ? <CopyButton value={payload} label="Copy JSON" /> : null}
      </div>
      {payload ? (
        <pre className="max-h-96 overflow-auto p-4 font-mono text-xs leading-6 break-all whitespace-pre-wrap select-text">
          {payload}
        </pre>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">
          No request payload was stored for this record.
        </p>
      )}
    </div>
  )
}
function TraceField({
  label,
  children,
  mono = false,
}: {
  label: string
  children: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-sm break-words",
          mono && "font-mono text-xs leading-5 break-all"
        )}
      >
        {children}
      </dd>
    </div>
  )
}
function TokenPair({
  input,
  output,
  label = "Input tokens / output tokens",
}: {
  input: number | null
  output: number | null
  label?: string
}) {
  return (
    <span className="tabular-nums" title={label}>
      {formatInt(input)} <span className="px-1 text-muted-foreground">/</span>{" "}
      {formatInt(output)}
    </span>
  )
}
const filterFields: {
  key: keyof CallTraceFilters
  label: string
  type?: "date"
}[] = [
  { key: "message_id", label: "Message ID" },
  { key: "user_id", label: "User ID" },
  { key: "api_key_id", label: "API key ID" },
  { key: "gateway_model_id", label: "Gateway model ID" },
  { key: "provider_model_id", label: "Provider model ID" },
  { key: "from", label: "From date", type: "date" },
  { key: "to", label: "To date", type: "date" },
]

export function TracesContent({ user }: { user?: CurrentUser } = {}) {
  const [tab, setTab] = React.useState<TabKey>("messages")
  const [reloadTick, setReloadTick] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState("")
  const [result, setResult] = React.useState<{
    tab: TabKey
    page: number
    tick: number
    filters: CallTraceFilters
    data: MessagesPage | CallsPage
  } | null>(null)
  const [failure, setFailure] = React.useState<{
    tab: TabKey
    page: number
    tick: number
    filters: CallTraceFilters
    message: string
  } | null>(null)
  const [draftFilters, setDraftFilters] = React.useState<CallTraceFilters>({})
  const [filters, setFilters] = React.useState<CallTraceFilters>({})
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  const [messageId, setMessageId] = React.useState<string | null>(null)
  const [drawerCall, setDrawerCall] = React.useState<CallTraceItem | null>(null)
  const searchId = React.useId()
  const statusId = React.useId()
  const [inlineInspector, setInlineInspector] = React.useState(false)
  React.useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)")
    const update = () => setInlineInspector(media.matches)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])
  const inspectedMessage = useTraceDetail(inlineInspector ? messageId : null)

  React.useEffect(() => {
    let cancelled = false
    const request =
      tab === "messages"
        ? listMessageTraces({ page, pageSize: PAGE_SIZE })
        : listCallTraces({ page, pageSize: PAGE_SIZE, filters })
    request
      .then((data) => {
        if (!cancelled)
          setResult({ tab, page, tick: reloadTick, filters, data })
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setFailure({
            tab,
            page,
            tick: reloadTick,
            filters,
            message:
              error instanceof Error ? error.message : "Unable to load traces.",
          })
      })
    return () => {
      cancelled = true
    }
  }, [tab, page, filters, reloadTick])
  const matchesRequest = (
    value: {
      tab: TabKey
      page: number
      tick: number
      filters: CallTraceFilters
    } | null
  ) =>
    value?.tab === tab &&
    value.page === page &&
    value.tick === reloadTick &&
    value.filters === filters
  const data = matchesRequest(result) ? result!.data : null
  const error = matchesRequest(failure) && !data ? failure!.message : null
  const loading = !data && !error
  const query = search.trim().toLowerCase()
  const items =
    data?.items.filter((item) => {
      const call = "provider_model" in item ? item : null
      return [
        item.id,
        item.message_id,
        item.user_id,
        item.api_key_id,
        item.status,
        requestModel(item.request),
        call?.gateway_model?.model_id,
        call?.provider_model?.model_id,
        call?.provider_model?.provider_name,
        call?.provider_model?.provider_alias,
        call?.error_code,
      ].some((value) => value?.toLowerCase().includes(query))
    }) ?? []
  const appliedCount = Object.keys(filters).length
  function resetFilters() {
    setDraftFilters({})
    setFilters({})
    setPage(1)
  }
  return (
    <PageContent>
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex max-w-2xl flex-col gap-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <IconRoute className="size-4" /> Observability{" "}
              {user?.role === "superuser" ? (
                <Badge variant="outline">Superuser</Badge>
              ) : null}
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">
              Trace explorer
            </h2>
            <p className="text-sm text-muted-foreground">
              Follow a request from arrival to its final provider attempt.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => setReloadTick((tick) => tick + 1)}
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
              Usage tracing is currently disabled for your account. New inference requests are not being recorded.
            </p>
            <Button asChild variant="outline" size="sm">
              <a href="/dashboard/settings">Enable in Settings</a>
            </Button>
          </div>
        ) : null}
        <div className="grid min-w-0 items-start gap-0 overflow-hidden rounded-xl border xl:grid-cols-[minmax(0,1fr)_360px]">
          <Tabs
            value={tab}
            onValueChange={(value) => {
              setTab(value as TabKey)
              setPage(1)
              setSearch("")
              setMessageId(null)
              setDrawerCall(null)
            }}
            className="min-w-0 gap-0"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 pt-3 pb-2">
              <TabsList variant="line">
                <TabsTrigger value="messages">
                  <IconRoute />
                  Messages
                </TabsTrigger>
                <TabsTrigger value="calls">
                  <IconRoute />
                  Provider calls
                </TabsTrigger>
              </TabsList>
              <span className="text-xs text-muted-foreground">
                {data
                  ? `${formatInt(data.total)} ${tab === "messages" ? "messages recorded" : "matching calls"}`
                  : "Recorded gateway traffic"}
              </span>
            </div>
            <div
              className="border-b bg-muted/10 px-4 py-4"
              aria-label="Outcomes on the loaded page"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  Loaded page · {data ? data.items.length : "—"} records
                </span>
                <span>
                  {data
                    ? `${data.items.filter((item) => item.status === "success").length} successful / ${data.items.filter((item) => item.status === "failed" || item.status === "timeout").length} unsuccessful`
                    : "Waiting for records"}
                </span>
              </div>
              <div
                className="flex h-7 gap-1"
                role="group"
                aria-label="Select a recorded request"
              >
                {data?.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={`Inspect ${item.status} ${item.id}`}
                    title={`${item.status} · ${item.id}`}
                    onClick={() => {
                      if ("provider_model" in item) {
                        setDrawerCall(item)
                        setMessageId(null)
                      } else {
                        setMessageId(item.id)
                        setDrawerCall(null)
                      }
                    }}
                    className={cn(
                      "min-w-0 flex-1 rounded-sm border border-border transition-opacity hover:opacity-60 focus-visible:outline-2 focus-visible:outline-ring",
                      item.status === "success"
                        ? "bg-green-600/65 dark:bg-green-400/65"
                        : item.status === "failed" || item.status === "timeout"
                          ? "bg-destructive/50"
                          : "bg-muted",
                      (messageId === item.id || drawerCall?.id === item.id) &&
                        "ring-2 ring-ring"
                    )}
                  />
                ))}
                {!data?.items.length && (
                  <div className="w-full rounded-sm bg-muted" />
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Each segment is one{" "}
                {tab === "messages" ? "message" : "provider call"}. Select to
                inspect.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4">
              <div className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-sm">
                <IconSearch
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <label htmlFor={searchId} className="sr-only">
                  Search this page
                </label>
                <Input
                  id={searchId}
                  type="search"
                  placeholder="Search this page…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              {tab === "calls" ? (
                <Button
                  variant="outline"
                  aria-expanded={filtersOpen}
                  aria-controls="trace-call-filters"
                  onClick={() => setFiltersOpen(!filtersOpen)}
                >
                  <IconFilter data-icon="inline-start" />
                  Filters
                  {appliedCount ? (
                    <Badge variant="secondary">{appliedCount}</Badge>
                  ) : null}
                </Button>
              ) : (
                <span className="hidden text-xs text-muted-foreground sm:block">
                  Recorded requests · oldest first
                </span>
              )}
            </div>
            {tab === "calls" ? (
              <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
                <CollapsibleContent id="trace-call-filters">
                  <form
                    className="mb-4 flex flex-col gap-4 rounded-lg border bg-muted/20 p-4"
                    onSubmit={(event) => {
                      event.preventDefault()
                      const next = Object.fromEntries(
                        Object.entries(draftFilters)
                          .filter(([, value]) => value?.trim())
                          .map(([key, value]) => [key, value.trim()])
                      ) as CallTraceFilters
                      setFilters(next)
                      setPage(1)
                      setSearch("")
                    }}
                  >
                    <div className="flex flex-col gap-1">
                      <h2 className="text-sm font-medium">
                        Filter provider calls
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        Filters apply to all recorded calls. Date bounds are
                        inclusive; model, user, and key IDs use UUIDs.
                      </p>
                    </div>
                    <FieldGroup className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
                          <SelectTrigger id={statusId} className="w-full">
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
                          (f) => user?.role === "superuser" || f.key !== "user_id"
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
                      <Button type="submit" size="sm">
                        Apply filters
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={resetFilters}
                      >
                        Reset filters
                      </Button>
                    </div>
                  </form>
                </CollapsibleContent>
              </Collapsible>
            ) : null}
            {appliedCount > 0 && tab === "calls" ? (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {Object.entries(filters).map(([key, value]) => (
                  <Badge key={key} variant="outline" className="max-w-full">
                    <span className="truncate">
                      {key.replaceAll("_", " ")}: {value}
                    </span>
                  </Badge>
                ))}
                <Button variant="ghost" size="sm" onClick={resetFilters}>
                  <IconX data-icon="inline-start" />
                  Clear
                </Button>
              </div>
            ) : null}
            <TabsContent
              value={tab}
              className="@container/trace mt-0"
              aria-busy={loading}
            >
              <div className="overflow-hidden rounded-xl border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                  <h2 className="text-sm font-medium">
                    {tab === "messages" ? "Request log" : "Provider call log"}
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    {tab === "messages"
                      ? "Message status includes all attempts"
                      : "Recorded calls · oldest first"}
                  </span>
                </div>
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
                    className="flex flex-col gap-5 p-5"
                    role="status"
                    aria-label="Loading traces"
                  >
                    {Array.from({ length: 6 }, (_, index) => (
                      <div key={index} className="flex items-center gap-6">
                        <Skeleton className="h-9 flex-1" />
                        <Skeleton className="h-6 w-20" />
                        <Skeleton className="hidden h-6 w-20 sm:block" />
                      </div>
                    ))}
                  </div>
                ) : !items.length ? (
                  <TraceEmpty
                    title={
                      query
                        ? "No matches on this page"
                        : appliedCount && tab === "calls"
                          ? "No calls match these filters"
                          : "No traces recorded yet"
                    }
                    description={
                      query
                        ? "Try another model, identifier, or status. Search covers only the current page of results."
                        : appliedCount && tab === "calls"
                          ? "Adjust your filters or clear them to see all recorded provider calls."
                          : "Enable tracing for a user in User Management, then send a request through the gateway to inspect it here."
                    }
                    action={
                      query ? (
                        <Button variant="outline" onClick={() => setSearch("")}>
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
                  <Table>
                    <TableHeader className="bg-muted/30">
                      <TableRow>
                        <TableHead className="pl-4">
                          {tab === "messages" ? "Request" : "Provider / model"}
                        </TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="hidden @min-[800px]/trace:table-cell">
                          {tab === "messages" ? "Attempts" : "Gateway model"}
                        </TableHead>
                        <TableHead className="hidden @min-[620px]/trace:table-cell">
                          Tokens{" "}
                          <span className="font-normal text-muted-foreground">
                            in / out
                          </span>
                        </TableHead>
                        <TableHead className="hidden text-right @min-[440px]/trace:table-cell">
                          {tab === "messages" ? "Call time ∑" : "Latency"}
                        </TableHead>
                        <TableHead className="w-12 pr-4">
                          <span className="sr-only">Inspect</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item) =>
                        "provider_model" in item ? (
                          <CallRow
                            key={item.id}
                            call={item}
                            selected={drawerCall?.id === item.id}
                            onOpen={() => {
                              setDrawerCall(item)
                              setMessageId(null)
                            }}
                          />
                        ) : (
                          <MessageRow
                            key={item.id}
                            item={item}
                            selected={messageId === item.id}
                            onOpen={() => {
                              setMessageId(item.id)
                              setDrawerCall(null)
                            }}
                          />
                        )
                      )}
                    </TableBody>
                  </Table>
                )}
                {data && data.total > 0 ? (
                  <TablePagination
                    page={page}
                    pageSize={data.page_size}
                    total={data.total}
                    onPageChange={(next) => {
                      setPage(next)
                      setSearch("")
                    }}
                  />
                ) : null}
              </div>
            </TabsContent>
          </Tabs>
          <aside
            aria-label="Trace inspection workspace"
            className="sticky top-0 hidden min-w-0 flex-col border-l bg-muted/10 xl:flex"
          >
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <IconCode className="size-4" />
                Inspector
              </h3>
              {(messageId || drawerCall) && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Clear selected trace"
                  onClick={() => {
                    setMessageId(null)
                    setDrawerCall(null)
                  }}
                >
                  <IconX />
                </Button>
              )}
            </div>
            <div className="flex max-h-[calc(100dvh-10rem)] min-w-0 flex-col gap-5 overflow-y-auto p-5">
              {messageId ? (
                inspectedMessage?.error ? (
                  <div role="alert" className="flex flex-col gap-3">
                    <p className="text-sm text-destructive">
                      {inspectedMessage.error}
                    </p>
                    <Button variant="outline" asChild>
                      <a
                        href={`/dashboard/traces/detail?id=${encodeURIComponent(messageId)}`}
                      >
                        Open full trace
                      </a>
                    </Button>
                  </div>
                ) : inspectedMessage?.trace ? (
                  <>
                    <div className="flex flex-col gap-3">
                      <TraceStatusBadge
                        status={inspectedMessage.trace.status}
                      />
                      <h3 className="text-base font-medium break-all">
                        {requestModel(inspectedMessage.trace.request)}
                      </h3>
                      <CopyButton value={messageId} label="Copy trace ID" />
                    </div>
                    <div className="grid grid-cols-2 gap-4 rounded-lg border p-3 text-xs">
                      <div>
                        <p className="text-muted-foreground">Provider calls</p>
                        <p className="mt-1 font-medium">
                          {inspectedMessage.trace.call_count}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">
                          Summed call time
                        </p>
                        <p className="mt-1 font-medium">
                          {formatMs(inspectedMessage.trace.total_latency_ms)}
                        </p>
                      </div>
                    </div>
                    <TraceInspectorTabs
                      key={messageId}
                      trace={inspectedMessage.trace}
                    />
                    <Button asChild variant="outline">
                      <a
                        href={`/dashboard/traces/detail?id=${encodeURIComponent(messageId)}`}
                      >
                        Open full trace
                        <IconArrowUpRight data-icon="inline-end" />
                      </a>
                    </Button>
                  </>
                ) : (
                  <>
                    <Skeleton className="h-8 w-2/3" />
                    <Skeleton className="h-40 w-full" />
                  </>
                )
              ) : drawerCall ? (
                <>
                  <TraceStatusBadge status={drawerCall.status} />
                  <h3 className="text-base font-medium break-all">
                    {drawerCall.provider_model?.model_id ??
                      "Unresolved provider"}
                  </h3>
                  <CallFacts call={drawerCall} />
                  <RequestBlock request={drawerCall.request} />
                </>
              ) : (
                <div className="flex flex-col gap-5 py-8">
                  <div className="flex size-12 items-center justify-center rounded-xl border bg-background">
                    <IconRoute className="size-6 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="font-medium">Start with a request</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Select a segment or open a row to inspect its provider
                      attempts, timing, and sanitized payload.
                    </p>
                  </div>
                  <ol className="flex flex-col gap-4 border-l pl-4 text-xs text-muted-foreground">
                    <li>Locate the request or provider call</li>
                    <li>Follow the ordered attempt timeline</li>
                    <li>Inspect errors and reported usage</li>
                  </ol>
                </div>
              )}
            </div>
          </aside>
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
      {!inlineInspector && (
        <>
          <MessageInspector
            traceId={messageId}
            onClose={() => setMessageId(null)}
          />
          <CallTraceDrawer
            call={drawerCall}
            onClose={() => setDrawerCall(null)}
          />
        </>
      )}
    </PageContent>
  )
}
function TraceEmpty({
  title,
  description,
  action,
  error = false,
}: {
  title: string
  description: string
  action?: React.ReactNode
  error?: boolean
}) {
  return (
    <div
      className="flex flex-col items-center gap-3 px-6 py-16 text-center"
      role={error ? "alert" : "status"}
    >
      <span className="flex size-12 items-center justify-center rounded-xl border bg-muted/40">
        {error ? (
          <IconBan className="size-6 text-destructive" />
        ) : (
          <IconRoute className="size-6 text-muted-foreground" />
        )}
      </span>
      <h3 className="mt-1 font-medium">{title}</h3>
      <p className="max-w-md text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
function MessageRow({
  item,
  onOpen,
  selected,
}: {
  item: MessageTraceItem
  onOpen: () => void
  selected?: boolean
}) {
  return (
    <TableRow data-state={selected ? "selected" : undefined}>
      <TableCell className="py-3 pl-4">
        <button
          type="button"
          className="flex max-w-[96px] min-w-0 flex-col gap-1.5 text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring min-[375px]:max-w-[130px] @min-[600px]/trace:max-w-[280px]"
          onClick={onOpen}
          aria-label={`Inspect message ${item.message_id ?? item.id}`}
        >
          <span
            className="w-full truncate font-medium"
            title={requestModel(item.request)}
          >
            {requestModel(item.request)}
          </span>
          <span
            className="w-full truncate text-xs text-muted-foreground"
            title={item.message_id ?? item.id}
          >
            {shortId(item.message_id ?? item.id)}
          </span>
          <span className="w-full truncate text-xs text-muted-foreground">
            {formatDateTime(item.created_at)}
          </span>
        </button>
      </TableCell>
      <TableCell>
        <TraceStatusBadge status={item.status} />
        <span className="mt-2 block text-xs text-muted-foreground tabular-nums @min-[440px]/trace:hidden">
          {formatMs(item.total_latency_ms)}
        </span>
      </TableCell>
      <TableCell className="hidden @min-[800px]/trace:table-cell">
        <span className="tabular-nums">
          {item.call_count}{" "}
          <span className="text-muted-foreground">
            {item.call_count === 1 ? "call" : "calls"}
          </span>
        </span>
        <span
          className={cn(
            "mt-1 block text-xs text-muted-foreground",
            item.failed_call_count > 0 && "text-destructive"
          )}
        >
          {item.failed_call_count
            ? `${item.failed_call_count} failed`
            : `${item.successful_call_count} succeeded`}
        </span>
      </TableCell>
      <TableCell className="hidden @min-[620px]/trace:table-cell">
        <TokenPair input={item.input_tokens} output={item.output_tokens} />
      </TableCell>
      <TableCell className="hidden text-right tabular-nums @min-[440px]/trace:table-cell">
        {formatMs(item.total_latency_ms)}
      </TableCell>
      <TableCell className="pr-4">
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Open message ${item.message_id ?? item.id}`}
          onClick={onOpen}
        >
          <IconChevronRight />
        </Button>
      </TableCell>
    </TableRow>
  )
}
function CallRow({
  call,
  onOpen,
  selected,
}: {
  call: CallTraceItem
  onOpen: () => void
  selected?: boolean
}) {
  return (
    <TableRow data-state={selected ? "selected" : undefined}>
      <TableCell className="py-3 pl-4">
        <button
          type="button"
          className="flex max-w-[96px] min-w-0 flex-col gap-1.5 text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring min-[375px]:max-w-[130px] @min-[600px]/trace:max-w-[260px]"
          onClick={onOpen}
          aria-label={`Inspect call ${call.id}`}
        >
          <span
            className="w-full truncate font-medium"
            title={call.provider_model?.model_id}
          >
            {call.provider_model?.model_id ?? "Unresolved provider"}
          </span>
          <span className="w-full truncate text-xs text-muted-foreground">
            {call.provider_model?.provider_name ?? "No provider recorded"}
          </span>
          <span className="w-full truncate text-xs text-muted-foreground">
            {formatDateTime(call.created_at)}
          </span>
        </button>
      </TableCell>
      <TableCell>
        <TraceStatusBadge status={call.status} />
        {call.error_code ? (
          <span
            className="mt-2 block max-w-20 truncate text-xs text-destructive min-[375px]:max-w-28"
            title={call.error_code}
          >
            {call.error_code}
          </span>
        ) : null}
        <span className="mt-2 block text-xs text-muted-foreground @min-[440px]/trace:hidden">
          {formatMs(call.latency_ms)}
        </span>
      </TableCell>
      <TableCell className="hidden max-w-40 @min-[800px]/trace:table-cell">
        <span className="block truncate" title={call.gateway_model?.model_id}>
          {call.gateway_model?.model_id ?? "—"}
        </span>
      </TableCell>
      <TableCell className="hidden @min-[620px]/trace:table-cell">
        <TokenPair input={call.input_tokens} output={call.output_tokens} />
      </TableCell>
      <TableCell className="hidden text-right tabular-nums @min-[440px]/trace:table-cell">
        {formatMs(call.latency_ms)}
      </TableCell>
      <TableCell className="pr-4">
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Open call ${call.id}`}
          onClick={onOpen}
        >
          <IconChevronRight />
        </Button>
      </TableCell>
    </TableRow>
  )
}
function FilterInput({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: "text" | "date"
}) {
  const id = React.useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}
function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
      <p className="text-xs text-muted-foreground tabular-nums">
        {formatInt((page - 1) * pageSize + 1)}–
        {formatInt(Math.min(total, page * pageSize))} of {formatInt(total)}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
function useTraceDetail(traceId: string | null, tick = 0) {
  const [result, setResult] = React.useState<{
    id: string
    tick: number
    trace?: MessageTraceDetail
    error?: string
  } | null>(null)
  React.useEffect(() => {
    if (!traceId) return
    let cancelled = false
    getMessageTrace(traceId)
      .then((trace) => {
        if (!cancelled) setResult({ id: traceId, tick, trace })
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setResult({
            id: traceId,
            tick,
            error:
              error instanceof Error
                ? error.message
                : "Unable to load the trace.",
          })
      })
    return () => {
      cancelled = true
    }
  }, [traceId, tick])
  return result?.id === traceId && result.tick === tick ? result : null
}
function TraceSummary({ trace }: { trace: MessageTraceItem }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-lg border bg-muted/20 p-4 sm:grid-cols-4">
      <TraceField label="Summed call time">
        {formatMs(trace.total_latency_ms)}
      </TraceField>
      <TraceField label="Provider calls">
        {formatInt(trace.call_count)}
      </TraceField>
      <TraceField label="Input tokens">
        {formatInt(trace.input_tokens)}
      </TraceField>
      <TraceField label="Output tokens">
        {formatInt(trace.output_tokens)}
      </TraceField>
    </dl>
  )
}
function TraceIdentity({ trace }: { trace: MessageTraceItem }) {
  return (
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <TraceField label="Trace ID" mono>
        {trace.id}
      </TraceField>
      <TraceField label="Message ID" mono>
        {trace.message_id ?? "—"}
      </TraceField>
      <TraceField label="User ID" mono>
        {trace.user_id}
      </TraceField>
      <TraceField label="API key ID" mono>
        {trace.api_key_id ?? "—"}
      </TraceField>
      <TraceField label="Started">
        {formatDateTime(trace.created_at)}
      </TraceField>
      <TraceField label="Finished">
        {formatDateTime(trace.finished_at)}
      </TraceField>
      <TraceField label="Cache tokens">
        {formatInt(trace.cache_tokens)}
      </TraceField>
    </dl>
  )
}
function AttemptTimeline({ calls }: { calls: CallTraceItem[] }) {
  if (!calls.length)
    return (
      <p className="rounded-lg border border-dashed p-6 text-sm leading-6 text-muted-foreground">
        No provider attempts were recorded. The request may have stopped before
        a provider was resolved.
      </p>
    )
  return (
    <ol className="flex flex-col">
      {calls.map((call, index) => (
        <li key={call.id} className="relative flex gap-3 pb-4 last:pb-0">
          <div className="relative flex w-7 shrink-0 justify-center">
            {index < calls.length - 1 ? (
              <span className="absolute top-7 bottom-[-4px] w-px bg-border" />
            ) : null}
            <span className="relative flex size-7 items-center justify-center rounded-full border bg-background text-xs text-muted-foreground tabular-nums">
              {index + 1}
            </span>
          </div>
          <Collapsible className="min-w-0 flex-1 overflow-hidden rounded-lg border">
            <CollapsibleTrigger className="group flex w-full flex-col gap-3 p-4 text-left outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring">
              <span className="flex w-full flex-wrap items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <IconChevronRight className="size-4 shrink-0 text-muted-foreground group-data-[state=open]:rotate-90" />
                  <span className="text-sm font-medium break-all">
                    {call.provider_model?.model_id ?? "Unresolved provider"}
                  </span>
                </span>
                <TraceStatusBadge status={call.status} />
              </span>
              <span className="flex flex-wrap justify-between gap-x-4 gap-y-1 pl-6 text-xs text-muted-foreground">
                <span>
                  {call.provider_model?.provider_name ?? "No provider recorded"}
                </span>
                <span className="tabular-nums">
                  {formatMs(call.latency_ms)}
                </span>
              </span>
              {call.error_code ? (
                <span className="pl-6 font-mono text-xs break-all text-destructive">
                  {call.error_code}
                </span>
              ) : null}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="border-t p-4">
                <CallFacts call={call} />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </li>
      ))}
    </ol>
  )
}
function CallFacts({ call }: { call: CallTraceItem }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
      <TraceField label="Gateway model" mono>
        {call.gateway_model?.model_id ?? "—"}
      </TraceField>
      <TraceField label="Provider alias" mono>
        {call.provider_model?.provider_alias ?? "—"}
      </TraceField>
      <TraceField label="Call ID" mono>
        {call.id}
      </TraceField>
      <TraceField label="Error code" mono>
        {call.error_code ?? "—"}
      </TraceField>
      <TraceField label="Input / output tokens">
        <TokenPair input={call.input_tokens} output={call.output_tokens} />
      </TraceField>
      <TraceField label="Cache tokens">
        {formatInt(call.cache_tokens)}
      </TraceField>
      <TraceField label="Uncached input">
        {formatInt(call.uncached_input_tokens)}
      </TraceField>
      <TraceField label="Cache read / write">
        <TokenPair
          input={call.cache_read_tokens}
          output={call.cache_write_tokens}
          label="Cache read tokens / cache write tokens"
        />
      </TraceField>
      <TraceField label="Started">{formatDateTime(call.created_at)}</TraceField>
      <TraceField label="Finished">
        {formatDateTime(call.finished_at)}
      </TraceField>
    </dl>
  )
}
// Controlled drawers have no DrawerTrigger to restore focus to.
function useDrawerFocus() {
  const opener = React.useRef<HTMLElement | null>(null)
  return {
    onOpenAutoFocus: () => {
      opener.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault()
      if (opener.current?.isConnected) opener.current.focus()
    },
  }
}

function MessageInspector({
  traceId,
  onClose,
}: {
  traceId: string | null
  onClose: () => void
}) {
  const isMobile = useIsMobile()
  const focusProps = useDrawerFocus()
  const [tick, setTick] = React.useState(0)
  const result = useTraceDetail(traceId, tick)
  const trace = result?.trace
  return (
    <Drawer
      autoFocus
      direction={isMobile ? "bottom" : "right"}
      open={traceId !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DrawerContent
        {...focusProps}
        className="data-[vaul-drawer-direction=bottom]:max-h-[92dvh] data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-2xl"
      >
        <DrawerHeader className="border-b">
          <div className="flex items-center justify-between gap-3">
            <DrawerTitle>Message trace</DrawerTitle>
            <DrawerClose asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close message trace"
              >
                <IconX />
              </Button>
            </DrawerClose>
          </div>
          <DrawerDescription>
            Inspect the request and its recorded provider attempts.
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {result?.error ? (
            <TraceEmpty
              error
              title="Unable to load this trace"
              description={result.error}
              action={
                <Button onClick={() => setTick((value) => value + 1)}>
                  Try again
                </Button>
              }
            />
          ) : trace ? (
            <div className="flex flex-col gap-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="min-w-0 text-lg font-medium break-all">
                  {requestModel(trace.request)}
                </h2>
                <TraceStatusBadge status={trace.status} />
              </div>
              <TraceSummary trace={trace} />
              <TraceInspectorTabs key={trace.id} trace={trace} />
            </div>
          ) : (
            <div
              className="flex flex-col gap-4"
              role="status"
              aria-label="Loading message trace"
            >
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-52 w-full" />
            </div>
          )}
        </div>
        <DrawerFooter className="border-t pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {traceId ? (
              <CopyButton value={traceId} label="Copy trace ID" />
            ) : null}
            <Button variant="outline" asChild>
              <a
                href={`/dashboard/traces/detail?id=${encodeURIComponent(traceId ?? "")}`}
              >
                Full trace
                <IconArrowUpRight data-icon="inline-end" />
              </a>
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
function TraceInspectorTabs({ trace }: { trace: MessageTraceDetail }) {
  return (
    <Tabs defaultValue="attempts" className="min-w-0 gap-5">
      <TabsList className="max-w-full">
        <TabsTrigger value="attempts">
          Attempts ({trace.calls.length})
        </TabsTrigger>
        <TabsTrigger value="request">Request</TabsTrigger>
        <TabsTrigger value="identity">Metadata</TabsTrigger>
      </TabsList>
      <TabsContent value="attempts">
        <div className="mb-4 flex flex-col gap-1">
          <h3 className="text-sm font-medium">Provider execution</h3>
          <p className="text-xs leading-5 text-muted-foreground">
            In recorded order. Expand an attempt for timing and token usage.
          </p>
        </div>
        <AttemptTimeline calls={trace.calls} />
      </TabsContent>
      <TabsContent value="request">
        <RequestBlock request={trace.request} />
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Secrets are redacted before storage. Large payloads may be truncated.
        </p>
      </TabsContent>
      <TabsContent value="identity">
        <TraceIdentity trace={trace} />
      </TabsContent>
    </Tabs>
  )
}
export function CallTraceDrawer({
  call,
  onClose,
}: {
  call: CallTraceItem | null
  onClose: () => void
}) {
  const isMobile = useIsMobile()
  const focusProps = useDrawerFocus()
  return (
    <Drawer
      autoFocus
      direction={isMobile ? "bottom" : "right"}
      open={call !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DrawerContent
        {...focusProps}
        className="data-[vaul-drawer-direction=bottom]:max-h-[92dvh] data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-xl"
      >
        <DrawerHeader className="border-b">
          <div className="flex items-center justify-between gap-3">
            <DrawerTitle>Provider attempt</DrawerTitle>
            <DrawerClose asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close provider attempt"
              >
                <IconX />
              </Button>
            </DrawerClose>
          </div>
          <DrawerDescription>
            Timing and provider-reported usage for one recorded call.
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {call ? (
            <div className="flex flex-col gap-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <h2 className="text-lg font-medium break-all">
                    {call.provider_model?.model_id ?? "Unresolved provider"}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {call.provider_model?.provider_name ??
                      "No provider recorded"}
                  </p>
                </div>
                <TraceStatusBadge status={call.status} />
              </div>
              <dl className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/20 p-4">
                <TraceField label="Duration">
                  {formatMs(call.latency_ms)}
                </TraceField>
                <TraceField label="Message ID" mono>
                  {call.message_id ?? "—"}
                </TraceField>
              </dl>
              <CallFacts call={call} />
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" className="w-full">
                    <IconCode data-icon="inline-start" />
                    Sanitized request
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                  <RequestBlock request={call.request} />
                </CollapsibleContent>
              </Collapsible>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TraceField label="User ID" mono>
                  {call.user_id}
                </TraceField>
                <TraceField label="API key ID" mono>
                  {call.api_key_id ?? "—"}
                </TraceField>
              </dl>
              <p className="text-xs leading-5 text-muted-foreground">
                Token counts are provider-reported; — means unreported. The
                sanitized request is inherited from the message trace. These are
                operational records; see Credits for billing.
              </p>
            </div>
          ) : null}
        </div>
        <DrawerFooter className="border-t pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {call ? <CopyButton value={call.id} label="Copy call ID" /> : null}
            <Button variant="outline" asChild>
              <a
                href={`/dashboard/traces/detail?id=${encodeURIComponent(call?.message_trace_id ?? "")}`}
              >
                View message
                <IconArrowUpRight data-icon="inline-end" />
              </a>
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
export function TraceDetailContent() {
  const [traceId] = React.useState(() =>
    new URLSearchParams(window.location.search).get("id")
  )
  const [tick, setTick] = React.useState(0)
  const result = useTraceDetail(traceId, tick)
  const trace = result?.trace
  return (
    <PageContent>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="ghost" size="sm">
            <a href="/dashboard/traces">
              <IconArrowLeft data-icon="inline-start" />
              All traces
            </a>
          </Button>
          {traceId ? (
            <Button
              variant="outline"
              disabled={!result}
              onClick={() => setTick((value) => value + 1)}
            >
              <IconRefresh data-icon="inline-start" />
              Refresh
            </Button>
          ) : null}
        </div>
        {!traceId ? (
          <TraceEmpty
            title="No trace selected"
            description="Open a message from Request traces to inspect its provider attempts."
          />
        ) : result?.error ? (
          <TraceEmpty
            error
            title="Unable to load the trace"
            description={result.error}
            action={
              <Button onClick={() => setTick((value) => value + 1)}>
                Try again
              </Button>
            }
          />
        ) : trace ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-2">
                <h1 className="text-2xl font-semibold tracking-tight break-all">
                  {requestModel(trace.request)}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {formatDateTime(trace.created_at)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <TraceStatusBadge status={trace.status} />
                <CopyButton value={trace.id} label="Copy trace ID" />
              </div>
            </div>
            <TraceSummary trace={trace} />
            <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle>Request inspection</CardTitle>
                  <CardDescription>
                    Follow provider execution or inspect the sanitized request.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <TraceInspectorTabs trace={trace} />
                </CardContent>
              </Card>
              <Card className="min-w-0 self-start">
                <CardHeader>
                  <CardTitle>Trace metadata</CardTitle>
                  <CardDescription>
                    Identifiers and provider-reported cache usage.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <TraceIdentity trace={trace} />
                </CardContent>
              </Card>
            </div>
          </>
        ) : (
          <div
            className="flex flex-col gap-5"
            role="status"
            aria-label="Loading trace"
          >
            <Skeleton className="h-12 w-2/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-80 w-full" />
          </div>
        )}
      </div>
    </PageContent>
  )
}
