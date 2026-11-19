import { Archive, Clock, Cpu, Layers } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { MessageTraceDetail, MessageTraceItem } from "@/lib/auth"
import {
  CopyButton,
  formatDateTime,
  formatInt,
  formatMs,
  shortId,
  requestModel,
  TraceStatusBadge,
} from "./shared"
import {
  RequestBlock,
  RequestMessagesView,
  RequestParametersView,
} from "./request-parts"
import { AttemptTimeline } from "./call-parts"

export function TraceMetadataTable({ trace }: { trace: MessageTraceItem }) {
  const rows: Array<{
    label: string
    value: string
    rawCopyValue?: string
    mono?: boolean
  }> = [
    {
      label: "Trace ID",
      value: trace.id,
      rawCopyValue: trace.id,
      mono: true,
    },
    {
      label: "Request / Message ID",
      value: trace.message_id ?? "—",
      rawCopyValue: trace.message_id ?? undefined,
      mono: true,
    },
    {
      label: "User ID",
      value: trace.user_id,
      rawCopyValue: trace.user_id,
      mono: true,
    },
    {
      label: "API Key ID",
      value: trace.api_key_id ?? "—",
      rawCopyValue: trace.api_key_id ?? undefined,
      mono: true,
    },
    {
      label: "Started At",
      value: formatDateTime(trace.created_at),
    },
    {
      label: "Finished At",
      value: formatDateTime(trace.finished_at),
    },
    {
      label: "Total Latency",
      value: formatMs(trace.total_latency_ms),
    },
    {
      label: "Cached Tokens",
      value: formatInt(trace.cache_tokens),
    },
    {
      label: "Upstream Calls",
      value: `${formatInt(trace.call_count)} total (${trace.successful_call_count} succeeded, ${trace.failed_call_count} failed)`,
    },
  ]

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-1/3">Attribute</TableHead>
            <TableHead>Value</TableHead>
            <TableHead className="w-20 text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.label}>
              <TableCell className="font-medium text-muted-foreground">
                {row.label}
              </TableCell>
              <TableCell
                className={cn(row.mono && "font-mono text-xs break-all")}
              >
                {row.value}
              </TableCell>
              <TableCell className="text-right">
                {row.rawCopyValue ? (
                  <CopyButton
                    value={row.rawCopyValue}
                    label={`Copy ${row.label}`}
                    iconOnly
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function TraceOverview({ trace }: { trace: MessageTraceDetail }) {
  const modelName = requestModel(trace.request)
  const totalTokens = (trace.input_tokens ?? 0) + (trace.output_tokens ?? 0)
  const messages = Array.isArray(trace.request?.messages)
    ? trace.request.messages
    : null
  const messagesCount = messages?.length ?? (trace.request?.prompt ? 1 : 0)

  return (
    <div className="flex flex-col gap-8">
      {/* 1. Header: Status, Timestamp, Model Name, Primary IDs */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <TraceStatusBadge status={trace.status} />
            <time className="text-xs text-muted-foreground">
              {formatDateTime(trace.created_at)}
            </time>
          </div>
          <CopyButton value={trace.id} label="Copy Trace ID" />
        </div>

        <h1 className="text-2xl font-bold tracking-tight break-all text-foreground">
          {modelName}
        </h1>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
          <span>
            Trace ID:{" "}
            <span className="text-foreground">{shortId(trace.id)}</span>
          </span>
          {trace.message_id ? (
            <span>
              Request ID:{" "}
              <span className="text-foreground">
                {shortId(trace.message_id)}
              </span>
            </span>
          ) : null}
          <span>
            User:{" "}
            <span className="text-foreground">{shortId(trace.user_id)}</span>
          </span>
        </div>
      </div>

      {/* 2. Plain KPI Stat Strip */}
      <div className="grid grid-cols-2 gap-6 border-y border-border py-4 sm:grid-cols-4">
        {/* Latency */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Clock className="size-3.5" />
            <span>Total Latency</span>
          </div>
          <div className="text-2xl font-bold text-foreground tabular-nums">
            {formatMs(trace.total_latency_ms)}
          </div>
          <span className="text-xs text-muted-foreground">
            End-to-end turnaround
          </span>
        </div>

        {/* Total Tokens */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Cpu className="size-3.5" />
            <span>Total Tokens</span>
          </div>
          <div className="text-2xl font-bold text-foreground tabular-nums">
            {trace.input_tokens != null || trace.output_tokens != null
              ? formatInt(totalTokens)
              : "—"}
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatInt(trace.input_tokens)} in /{" "}
            {formatInt(trace.output_tokens)} out
          </span>
        </div>

        {/* Provider attempts */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Layers className="size-3.5" />
            <span>Provider attempts</span>
          </div>
          <div className="text-2xl font-bold text-foreground tabular-nums">
            {trace.call_count}
          </div>
          <span
            className={cn(
              "text-xs tabular-nums",
              trace.failed_call_count > 0
                ? "font-medium text-destructive"
                : "text-muted-foreground"
            )}
          >
            {trace.failed_call_count > 0
              ? `${trace.failed_call_count} failed attempt${trace.failed_call_count > 1 ? "s" : ""}`
              : "All attempts succeeded"}
          </span>
        </div>

        {/* Cached Tokens */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Archive className="size-3.5" />
            <span>Cached Tokens</span>
          </div>
          <div className="text-2xl font-bold text-foreground tabular-nums">
            {formatInt(trace.cache_tokens)}
          </div>
          <span className="text-xs text-muted-foreground">
            Prompt cache hit tokens
          </span>
        </div>
      </div>

      {/* 3. Trace metadata */}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-foreground">
          Trace metadata
        </h2>
        <TraceMetadataTable trace={trace} />
      </section>

      <Separator />

      {/* 4. Messages Section */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Messages</h2>
          {messagesCount > 0 ? (
            <Badge variant="secondary" className="px-2 py-0.5 text-xs">
              {messagesCount} message{messagesCount > 1 ? "s" : ""}
            </Badge>
          ) : null}
        </div>
        <RequestParametersView request={trace.request} />
        <RequestMessagesView request={trace.request} modelName={modelName} />
      </section>

      <Separator />

      {/* 5. Provider attempts Section */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">
            Provider attempts
          </h2>
          {trace.calls.length > 0 ? (
            <Badge variant="secondary" className="px-2 py-0.5 text-xs">
              {trace.calls.length} attempt{trace.calls.length > 1 ? "s" : ""}
            </Badge>
          ) : null}
        </div>
        <AttemptTimeline calls={trace.calls} />
      </section>

      <Separator />

      {/* 6. Raw JSON Payload Section */}
      <section className="flex flex-col gap-3">
        <RequestBlock request={trace.request} />
      </section>
    </div>
  )
}
