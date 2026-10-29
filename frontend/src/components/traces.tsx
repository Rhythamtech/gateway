import * as React from "react"
import {
  IconBan,
  IconCircleCheckFilled,
  IconRefresh,
} from "@tabler/icons-react"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  getMessageTrace,
  listCallTraces,
  listMessageTraces,
  type CallTraceFilters,
  type CallTraceItem,
  type CallsPage,
  type MessageTraceDetail,
  type MessageTraceItem,
  type MessagesPage,
} from "@/lib/auth"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

const PAGE_SIZE = 20

type TabKey = "messages" | "calls"

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

// null ("not reported by the provider") renders as an em dash and stays
// visually distinct from a real 0, which renders as "0".
function formatInt(value: number | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : value.toLocaleString("en-US")
}

function formatMs(value: number | null) {
  if (value === null) return "—"
  if (value < 1_000) return `${value.toLocaleString("en-US")} ms`
  const seconds = value / 1_000
  if (seconds < 60)
    return `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)} s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  if (minutes < 60) return `${minutes}m ${rest}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

// Short display for long identifiers; the full value stays available via the
// native title tooltip.
function shortId(value: string | null | undefined) {
  if (!value) return "—"
  return `${value.slice(0, 8)}…`
}

function TraceStatusBadge({ status }: { status: string }) {
  if (status === "success") {
    return (
      <Badge variant="outline" className="px-1.5 text-muted-foreground">
        <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
        Success
      </Badge>
    )
  }
  if (status === "failed") {
    return (
      <Badge variant="outline" className="px-1.5 text-destructive">
        <IconBan />
        Failed
      </Badge>
    )
  }
  if (status === "timeout") {
    return (
      <Badge
        variant="outline"
        className="px-1.5 text-amber-700 dark:text-amber-400"
      >
        Timeout
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="px-1.5 text-muted-foreground">
      {status === "pending" ? "Pending" : status}
    </Badge>
  )
}

// Rendered as plain text so stored payloads stay untrusted output; the
// backend already redacted secrets ("[REDACTED]") and truncated large
// payloads before persisting them.
function RequestBlock({
  request,
}: {
  request: Record<string, unknown> | null
}) {
  if (!request || Object.keys(request).length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No request payload was stored for this record.
      </p>
    )
  }
  return (
    <div className="overflow-hidden rounded-lg border bg-muted">
      <pre className="max-h-72 overflow-auto p-3 font-mono text-xs leading-5 break-all select-all">
        {JSON.stringify(request, null, 2)}
      </pre>
    </div>
  )
}

function TracesChip({
  label,
  value,
  wrap,
}: {
  label: string
  value: React.ReactNode
  wrap?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border bg-muted p-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm${wrap ? "font-mono break-words" : ""}`}>
        {value}
      </span>
    </div>
  )
}

function AttemptCountsCell({
  total,
  ok,
  failed,
}: {
  total: number
  ok: number
  failed: number
}) {
  return (
    <span className="whitespace-nowrap">
      <span className="font-mono text-xs tabular-nums">{formatInt(total)}</span>
      <span className="ml-2 text-xs text-muted-foreground tabular-nums">
        {formatInt(ok)} ok · {formatInt(failed)} failed
      </span>
    </span>
  )
}

export function TracesContent() {
  const [tab, setTab] = React.useState<TabKey>("messages")
  const [reloadTick, setReloadTick] = React.useState(0)

  const [messageItems, setMessageItems] = React.useState<MessagesPage | null>(
    null
  )
  const [messagesError, setMessagesError] = React.useState<string | null>(null)
  const [messagesPage, setMessagesPage] = React.useState(1)

  const [callItems, setCallItems] = React.useState<CallsPage | null>(null)
  const [callsError, setCallsError] = React.useState<string | null>(null)
  const [callsPage, setCallsPage] = React.useState(1)
  const [draftFilters, setDraftFilters] = React.useState<CallTraceFilters>({})
  const [appliedFilters, setAppliedFilters] = React.useState<CallTraceFilters>(
    {}
  )

  const [drawerCall, setDrawerCall] = React.useState<CallTraceItem | null>(null)

  React.useEffect(() => {
    if (tab !== "messages") return
    let cancelled = false

    listMessageTraces({ page: messagesPage, pageSize: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return
        setMessageItems(result)
        setMessagesError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setMessagesError(
          error instanceof Error
            ? error.message
            : "Unable to load message traces."
        )
      })

    return () => {
      cancelled = true
    }
  }, [tab, messagesPage, reloadTick])

  React.useEffect(() => {
    if (tab !== "calls") return
    let cancelled = false

    listCallTraces({
      page: callsPage,
      pageSize: PAGE_SIZE,
      filters: appliedFilters,
    })
      .then((result) => {
        if (cancelled) return
        setCallItems(result)
        setCallsError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setCallsError(
          error instanceof Error ? error.message : "Unable to load call traces."
        )
      })

    return () => {
      cancelled = true
    }
  }, [tab, callsPage, appliedFilters, reloadTick])

  function refreshActive() {
    setReloadTick((tick) => tick + 1)
  }

  // The calls endpoint is the only trace list with documented filters; the
  // messages endpoint accepts pagination only, so its tab shows no filter UI.
  function applyFilters() {
    const next: CallTraceFilters = {}
    for (const [key, value] of Object.entries(draftFilters)) {
      const trimmed = value.trim()
      if (trimmed) next[key as keyof CallTraceFilters] = trimmed
    }
    setAppliedFilters(next)
    setCallsPage(1)
  }

  function resetFilters() {
    setDraftFilters({})
    setAppliedFilters({})
    setCallsPage(1)
  }

  const appliedCount = Object.keys(appliedFilters).length

  return (
    <>
      <div className="flex flex-col items-start justify-between gap-2 px-4 lg:flex-row lg:items-center lg:px-6">
        <p className="text-sm text-muted-foreground">
          Messages are inbound requests; calls are the actual provider attempts
          behind them — retries and failover included. Tokens are
          provider-reported and null when not reported; payloads are sanitized
          before storage. Viewing traces does not enable collection. Operational
          data — not billing.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={refreshActive}
        >
          <IconRefresh />
          <span className="hidden lg:inline">Refresh</span>
        </Button>
      </div>

      <div className="px-4 lg:px-6">
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as TabKey)}
          className="items-center"
        >
          <TabsList>
            <TabsTrigger value="messages">Messages</TabsTrigger>
            <TabsTrigger value="calls">Calls</TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === "calls" ? (
          <div className="mt-3 flex flex-col gap-3 rounded-lg border bg-card p-3">
            <p className="text-xs font-medium text-muted-foreground">
              Filters{appliedCount > 0 ? ` (${appliedCount} applied)` : ""}
            </p>
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted-foreground">
                Identifiers and status
              </span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <FilterInput
                  label="Message ID"
                  value={draftFilters.message_id ?? ""}
                  onChange={(value) =>
                    setDraftFilters((draft) => ({
                      ...draft,
                      message_id: value,
                    }))
                  }
                />
                <FilterInput
                  label="User ID (UUID)"
                  value={draftFilters.user_id ?? ""}
                  onChange={(value) =>
                    setDraftFilters((draft) => ({ ...draft, user_id: value }))
                  }
                />
                <FilterInput
                  label="API key ID (UUID)"
                  value={draftFilters.api_key_id ?? ""}
                  onChange={(value) =>
                    setDraftFilters((draft) => ({
                      ...draft,
                      api_key_id: value,
                    }))
                  }
                />
                <FilterInput
                  label="Gateway model ID (model group UUID)"
                  value={draftFilters.gateway_model_id ?? ""}
                  onChange={(value) =>
                    setDraftFilters((draft) => ({
                      ...draft,
                      gateway_model_id: value,
                    }))
                  }
                />
                <FilterInput
                  label="Provider model ID (UUID)"
                  value={draftFilters.provider_model_id ?? ""}
                  onChange={(value) =>
                    setDraftFilters((draft) => ({
                      ...draft,
                      provider_model_id: value,
                    }))
                  }
                />
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Status</span>
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
                      size="sm"
                      className="w-full"
                      aria-label="Filter by status"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any status</SelectItem>
                      <SelectItem value="success">Success</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                      <SelectItem value="timeout">Timeout</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted-foreground">
                Recorded date (both bounds inclusive)
              </span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <FilterInput
                  label="From date"
                  type="date"
                  value={draftFilters.from ?? ""}
                  onChange={(value) =>
                    setDraftFilters((draft) => ({ ...draft, from: value }))
                  }
                />
                <FilterInput
                  label="To date"
                  type="date"
                  value={draftFilters.to ?? ""}
                  onChange={(value) =>
                    setDraftFilters((draft) => ({ ...draft, to: value }))
                  }
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" onClick={applyFilters}>
                Apply filters
              </Button>
              {appliedCount > 0 || Object.keys(draftFilters).length > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={resetFilters}
                >
                  Reset
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === "messages" ? (
          <>
            {messagesError !== null && messageItems !== null ? (
              <p className="mt-3 mb-2 text-sm text-destructive" role="alert">
                {messagesError}{" "}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={refreshActive}
                >
                  Try again
                </button>
              </p>
            ) : null}
            <div className="mt-3 overflow-hidden rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted">
                  <TableRow>
                    <TableHead>Created</TableHead>
                    <TableHead>Message ID</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>API key</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead>Tokens (in / out)</TableHead>
                    <TableHead className="text-right">Latency</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {messageItems === null ? (
                    <TableRow>
                      <TableCell
                        colSpan={9}
                        className="h-24 text-center text-muted-foreground"
                      >
                        {messagesError !== null ? (
                          <span>
                            {messagesError}{" "}
                            <button
                              type="button"
                              className="underline underline-offset-2"
                              onClick={refreshActive}
                            >
                              Try again
                            </button>
                          </span>
                        ) : (
                          "Loading message traces…"
                        )}
                      </TableCell>
                    </TableRow>
                  ) : messageItems.items.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={9}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No message traces recorded. Tracing is opt-in per user
                        and requests from users with tracing disabled are not
                        persisted; viewing this page never enables collection.
                      </TableCell>
                    </TableRow>
                  ) : (
                    messageItems.items.map((item) => (
                      <MessageRow key={item.id} item={item} />
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {messageItems && messageItems.total > 0 ? (
              <TablePagination
                page={messagesPage}
                pageSize={messageItems.page_size}
                total={messageItems.total}
                onPageChange={setMessagesPage}
              />
            ) : null}
          </>
        ) : (
          <>
            {callsError !== null && callItems !== null ? (
              <p className="mt-3 mb-2 text-sm text-destructive" role="alert">
                {callsError}{" "}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={refreshActive}
                >
                  Try again
                </button>
              </p>
            ) : null}
            <div className="mt-3 overflow-hidden rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted">
                  <TableRow>
                    <TableHead>Created</TableHead>
                    <TableHead>Message ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Gateway model</TableHead>
                    <TableHead>Provider attempt</TableHead>
                    <TableHead>Tokens (in / out)</TableHead>
                    <TableHead className="text-right">Latency</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {callItems === null ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="h-24 text-center text-muted-foreground"
                      >
                        {callsError !== null ? (
                          <span>
                            {callsError}{" "}
                            <button
                              type="button"
                              className="underline underline-offset-2"
                              onClick={refreshActive}
                            >
                              Try again
                            </button>
                          </span>
                        ) : (
                          "Loading call traces…"
                        )}
                      </TableCell>
                    </TableRow>
                  ) : callItems.items.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="h-24 text-center text-muted-foreground"
                      >
                        {appliedCount > 0 ? (
                          <span>
                            No call traces match these filters.{" "}
                            <button
                              type="button"
                              className="underline underline-offset-2"
                              onClick={resetFilters}
                            >
                              Reset filters
                            </button>{" "}
                            to see all recorded attempts.
                          </span>
                        ) : (
                          "No call traces recorded. Tracing is opt-in per user and requests from users with tracing disabled are not persisted; viewing this page never enables collection."
                        )}
                      </TableCell>
                    </TableRow>
                  ) : (
                    callItems.items.map((call) => (
                      <CallRow
                        key={call.id}
                        call={call}
                        onOpen={() => setDrawerCall(call)}
                      />
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {callItems && callItems.total > 0 ? (
              <TablePagination
                page={callsPage}
                pageSize={callItems.page_size}
                total={callItems.total}
                onPageChange={setCallsPage}
              />
            ) : null}
          </>
        )}
      </div>

      <CallTraceDrawer call={drawerCall} onClose={() => setDrawerCall(null)} />
    </>
  )
}

function MessageRow({ item }: { item: MessageTraceItem }) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground">
        {formatDateTime(item.created_at)}
      </TableCell>
      <TableCell>
        {item.message_id ? (
          <span
            className="block max-w-40 truncate font-mono text-xs"
            title={item.message_id}
          >
            {item.message_id}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        <span
          className="font-mono text-xs text-muted-foreground"
          title={item.user_id}
        >
          {shortId(item.user_id)}
        </span>
      </TableCell>
      <TableCell>
        <span
          className="font-mono text-xs text-muted-foreground"
          title={item.api_key_id ?? ""}
        >
          {item.api_key_id ? shortId(item.api_key_id) : "—"}
        </span>
      </TableCell>
      <TableCell>
        <TraceStatusBadge status={item.status} />
      </TableCell>
      <TableCell>
        <AttemptCountsCell
          total={item.call_count}
          ok={item.successful_call_count}
          failed={item.failed_call_count}
        />
      </TableCell>
      <TableCell className="font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        {formatInt(item.input_tokens)} / {formatInt(item.output_tokens)}
      </TableCell>
      <TableCell className="text-right font-mono text-xs text-muted-foreground tabular-nums">
        {formatMs(item.total_latency_ms)}
      </TableCell>
      <TableCell className="text-right">
        <Button variant="outline" size="sm" asChild>
          <a href={`/dashboard/traces/detail?id=${item.id}`}>Open trace</a>
        </Button>
      </TableCell>
    </TableRow>
  )
}

function CallRow({
  call,
  onOpen,
}: {
  call: CallTraceItem
  onOpen: () => void
}) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground">
        {formatDateTime(call.created_at)}
      </TableCell>
      <TableCell>
        {call.message_id ? (
          <span
            className="block max-w-40 truncate font-mono text-xs"
            title={call.message_id}
          >
            {call.message_id}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        <TraceStatusBadge status={call.status} />
      </TableCell>
      <TableCell>
        <span className="font-mono text-xs break-all text-muted-foreground">
          {call.gateway_model ? call.gateway_model.model_id : "—"}
        </span>
      </TableCell>
      <TableCell>
        {call.provider_model ? (
          <span className="font-mono text-xs break-words whitespace-nowrap">
            {call.provider_model.provider_alias}/{call.provider_model.model_id}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        {formatInt(call.input_tokens)} / {formatInt(call.output_tokens)}
      </TableCell>
      <TableCell className="text-right font-mono text-xs text-muted-foreground tabular-nums">
        {formatMs(call.latency_ms)}
      </TableCell>
      <TableCell className="text-right">
        <Button variant="outline" size="sm" onClick={onOpen}>
          Attempt detail
        </Button>
      </TableCell>
    </TableRow>
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

  return (
    <Drawer
      direction={isMobile ? "bottom" : "right"}
      open={call !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DrawerContent>
        <DrawerHeader className="shrink-0 gap-1 border-b">
          <DrawerTitle>Provider attempt</DrawerTitle>
          <DrawerDescription>
            One actual gateway/provider attempt for a recorded message — failed
            and timed-out attempts included. Operational data — not billing.
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-2 text-sm">
          {call ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <TracesChip
                  label="Status"
                  value={
                    <span className="flex items-center gap-1">
                      <TraceStatusBadge status={call.status} />
                    </span>
                  }
                />
                <TracesChip label="Latency" value={formatMs(call.latency_ms)} />
                <TracesChip
                  label="Error code"
                  value={
                    call.error_code ? (
                      <span className="font-mono text-xs break-all">
                        {call.error_code}
                      </span>
                    ) : (
                      "—"
                    )
                  }
                />
                <TracesChip
                  label="Created"
                  value={formatDateTime(call.created_at)}
                />
                <TracesChip
                  label="Finished"
                  value={formatDateTime(call.finished_at)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Request, model, and actor identity — full identifiers on hover
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <TracesChip
                    label="Gateway model"
                    wrap
                    value={
                      call.gateway_model ? (
                        <span
                          className="font-mono text-xs break-all"
                          title={call.gateway_model.model_id}
                        >
                          {call.gateway_model.model_id}
                        </span>
                      ) : (
                        "—"
                      )
                    }
                  />
                  <TracesChip
                    label="Provider attempt"
                    wrap
                    value={
                      call.provider_model ? (
                        <span
                          className="font-mono text-xs break-words"
                          title={`${call.provider_model.provider_alias}/${call.provider_model.model_id}`}
                        >
                          {call.provider_model.provider_alias}/
                          {call.provider_model.model_id}
                        </span>
                      ) : (
                        "—"
                      )
                    }
                  />
                  <TracesChip
                    label="Message ID"
                    value={
                      call.message_id ? (
                        <span
                          className="font-mono text-xs break-all"
                          title={call.message_id}
                        >
                          {shortId(call.message_id)}
                        </span>
                      ) : (
                        "—"
                      )
                    }
                  />
                  <TracesChip
                    label="Message trace"
                    value={
                      <span
                        className="font-mono text-xs break-all"
                        title={call.message_trace_id}
                      >
                        {shortId(call.message_trace_id)}
                      </span>
                    }
                  />
                  <TracesChip
                    label="User"
                    value={
                      <span
                        className="font-mono text-xs break-all"
                        title={call.user_id}
                      >
                        {shortId(call.user_id)}
                      </span>
                    }
                  />
                  <TracesChip
                    label="API key"
                    value={
                      call.api_key_id ? (
                        <span
                          className="font-mono text-xs break-all"
                          title={call.api_key_id}
                        >
                          {shortId(call.api_key_id)}
                        </span>
                      ) : (
                        "—"
                      )
                    }
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Provider-reported token usage — null when the provider did not
                  report a figure, never imputed
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <TracesChip
                    label="Input tokens"
                    value={formatInt(call.input_tokens)}
                  />
                  <TracesChip
                    label="Output tokens"
                    value={formatInt(call.output_tokens)}
                  />
                  <TracesChip
                    label="Cache tokens"
                    value={formatInt(call.cache_tokens)}
                  />
                  <TracesChip
                    label="Uncached input"
                    value={formatInt(call.uncached_input_tokens)}
                  />
                  <TracesChip
                    label="Cache read"
                    value={formatInt(call.cache_read_tokens)}
                  />
                  <TracesChip
                    label="Cache write"
                    value={formatInt(call.cache_write_tokens)}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Recorded accounting — wallet fields exactly as returned;
                  credits are operational, not currency, and no rates are
                  derived
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <TracesChip
                    label="User credits charged"
                    value={formatInt(call.user_credits_charged)}
                  />
                  <TracesChip
                    label="Billable token units"
                    value={formatInt(call.billable_token_units)}
                  />
                  <TracesChip
                    label="Usage source"
                    value={
                      <span className="font-mono text-xs break-words">
                        {call.token_usage_source ?? "—"}
                      </span>
                    }
                  />
                  <TracesChip
                    label="Credit multiplier (ppm)"
                    value={formatInt(call.credit_multiplier_ppm)}
                  />
                  <TracesChip
                    label="Provider budget credits consumed"
                    value={formatInt(call.provider_budget_credits_consumed)}
                  />
                  <TracesChip
                    label="Provider cost (nanos)"
                    value={
                      <span className="font-mono text-xs break-words tabular-nums">
                        {call.provider_cost_nanos.toLocaleString("en-US")}
                        {call.currency_code ? ` ${call.currency_code}` : ""}
                      </span>
                    }
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Sanitized request — inherited from the message trace; secrets
                  were redacted before storage and large payloads are truncated
                </p>
                <RequestBlock request={call.request} />
              </div>
            </>
          ) : null}
        </div>
        <DrawerFooter
          className="shrink-0 border-t"
          style={{
            paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
          }}
        >
          <div className="flex w-full items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              asChild
              disabled={call === null}
            >
              <a href={`/dashboard/traces/detail?id=${call?.message_trace_id}`}>
                View message
              </a>
            </Button>
            <DrawerClose asChild>
              <Button type="button" size="sm">
                Close
              </Button>
            </DrawerClose>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
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
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border bg-transparent px-3 py-1 text-sm shadow-2xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
    </div>
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
  const start = (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)

  return (
    <div className="flex flex-col items-start justify-between gap-2 pt-2 sm:flex-row sm:items-center">
      <p className="text-sm text-muted-foreground">
        Showing {start.toLocaleString("en-US")}–{end.toLocaleString("en-US")} of{" "}
        {total.toLocaleString("en-US")}.
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <span className="text-sm text-muted-foreground tabular-nums">
          Page {page} of {totalPages}
        </span>
        <Button
          type="button"
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

export function TraceDetailContent() {
  const [traceId] = React.useState(
    () => new URLSearchParams(window.location.search).get("id") ?? ""
  )
  const [trace, setTrace] = React.useState<MessageTraceDetail | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [reloadTick, setReloadTick] = React.useState(0)
  const [drawerCall, setDrawerCall] = React.useState<CallTraceItem | null>(null)

  React.useEffect(() => {
    if (!traceId) return
    let cancelled = false

    getMessageTrace(traceId)
      .then((result) => {
        if (cancelled) return
        setTrace(result)
        setError(null)
      })
      .catch((requestError: unknown) => {
        if (cancelled) return
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load the trace."
        )
      })

    return () => {
      cancelled = true
    }
  }, [traceId, reloadTick])

  if (!traceId) {
    return (
      <div className="px-4 lg:px-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>No trace selected</CardTitle>
            <CardDescription>
              Open a trace from the LLM Traces list to see its details.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild>
              <a href="/dashboard/traces">All traces</a>
            </Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  if (error !== null && trace === null) {
    return (
      <div className="px-4 lg:px-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Unable to load the trace</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button onClick={() => setReloadTick((tick) => tick + 1)}>
              Try again
            </Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  if (trace === null) {
    return (
      <div className="px-4 py-16 text-center text-muted-foreground lg:px-6">
        Loading trace…
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col items-start justify-between gap-2 px-4 lg:flex-row lg:items-center lg:px-6">
        <p className="text-sm text-muted-foreground">
          One inbound request and its recorded provider attempts — retries and
          failover included. Payloads are sanitized before storage. Operational
          data — not billing.
        </p>
        <Button asChild size="sm" variant="outline">
          <a href="/dashboard/traces">All traces</a>
        </Button>
      </div>

      <div className="px-4 lg:px-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Message trace
              <TraceStatusBadge status={trace.status} />
            </CardTitle>
            <CardDescription>
              Created {formatDateTime(trace.created_at)} · finished{" "}
              {formatDateTime(trace.finished_at)} · message status is success
              when any attempt succeeded, else timeout, else failed
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <TracesChip
                label="Trace ID"
                value={
                  <span
                    className="font-mono text-xs break-all"
                    title={trace.id}
                  >
                    {trace.id}
                  </span>
                }
              />
              <TracesChip
                label="Message ID"
                value={
                  trace.message_id ? (
                    <span
                      className="font-mono text-xs break-all"
                      title={trace.message_id}
                    >
                      {trace.message_id}
                    </span>
                  ) : (
                    "—"
                  )
                }
              />
              <TracesChip
                label="User"
                value={
                  <span
                    className="font-mono text-xs break-all"
                    title={trace.user_id}
                  >
                    {trace.user_id}
                  </span>
                }
              />
              <TracesChip
                label="API key"
                value={
                  trace.api_key_id ? (
                    <span
                      className="font-mono text-xs break-all"
                      title={trace.api_key_id}
                    >
                      {trace.api_key_id}
                    </span>
                  ) : (
                    "—"
                  )
                }
              />
              <TracesChip
                label="Attempts"
                value={
                  <span className="font-mono text-xs tabular-nums">
                    {formatInt(trace.call_count)} total ·{" "}
                    {formatInt(trace.successful_call_count)} ok ·{" "}
                    {formatInt(trace.failed_call_count)} failed
                  </span>
                }
              />
              <TracesChip
                label="Tokens (in / out)"
                value={
                  <span className="font-mono text-xs tabular-nums">
                    {formatInt(trace.input_tokens)} /{" "}
                    {formatInt(trace.output_tokens)}
                  </span>
                }
              />
              <TracesChip
                label="Cache tokens"
                value={formatInt(trace.cache_tokens)}
              />
              <TracesChip
                label="Total latency"
                value={formatMs(trace.total_latency_ms)}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="px-4 lg:px-6">
        <Card>
          <CardHeader>
            <CardTitle>
              Recorded provider attempts ({trace.calls.length})
            </CardTitle>
            <CardDescription>
              In the order the gateway recorded them — retries and failover
              included. Open one for usage, accounting, and the inherited
              request payload.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {trace.calls.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No provider attempts recorded for this message — the request may
                have failed before resolving to a provider.
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader className="bg-muted">
                    <TableRow>
                      <TableHead>Created</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Gateway model</TableHead>
                      <TableHead>Provider attempt</TableHead>
                      <TableHead>Tokens (in / out)</TableHead>
                      <TableHead className="text-right">Latency</TableHead>
                      <TableHead>Error</TableHead>
                      <TableHead>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trace.calls.map((call) => (
                      <TableRow key={call.id}>
                        <TableCell className="text-muted-foreground">
                          {formatDateTime(call.created_at)}
                        </TableCell>
                        <TableCell>
                          <TraceStatusBadge status={call.status} />
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-xs break-all text-muted-foreground">
                            {call.gateway_model
                              ? call.gateway_model.model_id
                              : "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          {call.provider_model ? (
                            <span className="font-mono text-xs break-words whitespace-nowrap">
                              {call.provider_model.provider_alias}/
                              {call.provider_model.model_id}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                          {formatInt(call.input_tokens)} /{" "}
                          {formatInt(call.output_tokens)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                          {formatMs(call.latency_ms)}
                        </TableCell>
                        <TableCell>
                          {call.error_code ? (
                            <span
                              className="font-mono text-xs break-all text-destructive"
                              title={call.error_code}
                            >
                              {call.error_code}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDrawerCall(call)}
                          >
                            Attempt detail
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="px-4 lg:px-6">
        <Card>
          <CardHeader>
            <CardTitle>Sanitized request</CardTitle>
            <CardDescription>
              Stored once per message; secrets were redacted before storage and
              large payloads are truncated.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RequestBlock request={trace.request} />
          </CardContent>
        </Card>
      </div>

      <CallTraceDrawer call={drawerCall} onClose={() => setDrawerCall(null)} />
    </>
  )
}
