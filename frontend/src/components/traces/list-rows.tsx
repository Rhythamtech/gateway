import * as React from "react"
import { IconEye } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import type {
  CallTraceFilters,
  CallTraceItem,
  MessageTraceItem,
} from "@/lib/auth"
import { FieldLabel } from "@/components/ui/field"
import {
  CopyButton,
  formatDateTime,
  formatInt,
  formatMs,
  requestModel,
  shortId,
  TokenPair,
  TraceStatusBadge,
} from "./shared"

export function MessageRow({ item }: { item: MessageTraceItem }) {
  const modelName = requestModel(item.request)
  const totalTokens = (item.input_tokens ?? 0) + (item.output_tokens ?? 0)
  const displayId = item.message_id ?? item.id
  const detailHref = `/dashboard/traces/detail?id=${encodeURIComponent(item.id)}`

  return (
    <TableRow
      className="cursor-pointer transition-colors hover:bg-muted/50"
      onClick={() => window.location.assign(detailHref)}
    >
      {/* 1. Time */}
      <TableCell className="pl-4 font-mono text-xs whitespace-nowrap text-muted-foreground">
        {formatDateTime(item.created_at)}
      </TableCell>

      {/* 2. Request ID */}
      <TableCell className="font-mono text-xs whitespace-nowrap">
        <div className="flex items-center gap-1">
          <span title={displayId} className="font-medium text-foreground">
            {shortId(displayId)}
          </span>
          <CopyButton value={displayId} label="Copy ID" iconOnly />
        </div>
      </TableCell>

      {/* 3. Model */}
      <TableCell>
        <div className="flex max-w-[240px] flex-col">
          <span
            className="truncate text-sm font-semibold text-foreground"
            title={modelName}
          >
            {modelName}
          </span>
          {item.api_key_id ? (
            <span
              className="truncate font-mono text-[10px] text-muted-foreground"
              title={`API key: ${item.api_key_id}`}
            >
              key: {shortId(item.api_key_id)}
            </span>
          ) : null}
        </div>
      </TableCell>

      {/* 4. Status */}
      <TableCell>
        <TraceStatusBadge status={item.status} />
      </TableCell>

      {/* 5. Latency */}
      <TableCell className="text-right font-mono text-xs whitespace-nowrap tabular-nums">
        {formatMs(item.total_latency_ms)}
      </TableCell>

      {/* 6. Tokens */}
      <TableCell className="whitespace-nowrap">
        <div className="flex flex-col">
          <TokenPair input={item.input_tokens} output={item.output_tokens} />
          {item.input_tokens != null || item.output_tokens != null ? (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {formatInt(totalTokens)} total
            </span>
          ) : null}
        </div>
      </TableCell>

      {/* 7. Attempts */}
      <TableCell className="whitespace-nowrap">
        <span className="text-xs font-medium tabular-nums">
          {item.call_count} {item.call_count === 1 ? "call" : "calls"}
        </span>
        <span
          className={cn(
            "block text-[11px] tabular-nums",
            item.failed_call_count > 0
              ? "font-medium text-destructive"
              : "text-muted-foreground"
          )}
        >
          {item.failed_call_count > 0
            ? `${item.failed_call_count} failed`
            : `${item.successful_call_count} succeeded`}
        </span>
      </TableCell>

      {/* 8. Actions */}
      <TableCell className="pr-4 text-right">
        <Button
          asChild
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2.5 text-xs"
          aria-label={`Inspect request ${displayId}`}
        >
          <a href={detailHref}>
            <IconEye className="size-3.5" />
            View
          </a>
        </Button>
      </TableCell>
    </TableRow>
  )
}

export function CallRow({ call }: { call: CallTraceItem }) {
  const detailHref = `/dashboard/traces/detail?id=${encodeURIComponent(call.message_trace_id)}&tab=attempts`

  return (
    <TableRow
      className="cursor-pointer transition-colors hover:bg-muted/50"
      onClick={() => window.location.assign(detailHref)}
    >
      <TableCell className="pl-4 font-mono text-xs whitespace-nowrap text-muted-foreground">
        {formatDateTime(call.created_at)}
      </TableCell>
      <TableCell className="font-mono text-xs whitespace-nowrap">
        <div className="flex items-center gap-1">
          <span title={call.id} className="font-medium text-foreground">
            {shortId(call.id)}
          </span>
          <CopyButton value={call.id} label="Copy ID" iconOnly />
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col">
          <span className="text-xs font-medium text-foreground">
            {call.provider_model?.provider_name ?? "No provider recorded"}
          </span>
          {call.provider_model?.provider_alias ? (
            <Badge
              variant="outline"
              className="mt-0.5 w-fit px-1 py-0 text-[10px] font-normal"
            >
              {call.provider_model.provider_alias}
            </Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell
        className="max-w-[180px] truncate font-mono text-xs"
        title={call.provider_model?.model_id}
      >
        {call.provider_model?.model_id ?? "—"}
      </TableCell>
      <TableCell
        className="max-w-[160px] truncate font-mono text-xs"
        title={call.gateway_model?.model_id}
      >
        {call.gateway_model?.model_id ?? "—"}
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <TraceStatusBadge status={call.status} />
          {call.error_code ? (
            <span
              className="max-w-[120px] truncate font-mono text-[10px] text-destructive"
              title={call.error_code}
            >
              {call.error_code}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-right font-mono text-xs whitespace-nowrap tabular-nums">
        {formatMs(call.latency_ms)}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <TokenPair input={call.input_tokens} output={call.output_tokens} />
      </TableCell>
      <TableCell className="pr-4 text-right">
        <Button
          asChild
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2.5 text-xs"
          aria-label={`Inspect call ${call.id}`}
        >
          <a href={detailHref}>
            <IconEye className="size-3.5" />
            View
          </a>
        </Button>
      </TableCell>
    </TableRow>
  )
}

export function FilterInput({
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

export const filterFields: {
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

export function TablePagination({
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
