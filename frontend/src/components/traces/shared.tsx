import * as React from "react"
import { Ban, Check, Copy, Route } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { CallTraceItem, MessageTraceItem } from "@/lib/auth"
import { formatTimestampInDeviceZone, parseApiTimestamp } from "@/lib/datetime"

export type TabKey = "messages" | "calls"

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—"
  const date = parseApiTimestamp(value)
  return date === null ? value : formatTimestampInDeviceZone(date)
}

export function formatInt(value: number | null | undefined) {
  return value == null ? "—" : value.toLocaleString("en-US")
}

export function formatMs(value: number | null) {
  if (value === null) return "—"
  if (value < 1000) return `${value.toLocaleString("en-US")} ms`
  if (value < 60000) return `${(value / 1000).toFixed(2)} s`
  const seconds = Math.round(value / 1000)
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function shortId(value: string | null | undefined) {
  if (!value) return "—"
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value
}

export function requestModel(request: Record<string, unknown> | null) {
  return typeof request?.model === "string" ? request.model : "Inbound request"
}

export function TraceStatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase()
  const variant =
    normalized === "success"
      ? "default"
      : normalized === "failed" || normalized === "timeout"
        ? "destructive"
        : normalized === "pending"
          ? "secondary"
          : "outline"

  return (
    <Badge variant={variant} className="gap-1.5 font-normal capitalize">
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          normalized === "success" && "bg-emerald-400",
          (normalized === "failed" || normalized === "timeout") &&
            "bg-rose-300",
          normalized === "pending" && "animate-pulse bg-amber-400",
          normalized !== "success" &&
            normalized !== "failed" &&
            normalized !== "timeout" &&
            normalized !== "pending" &&
            "bg-muted-foreground"
        )}
      />
      {status}
    </Badge>
  )
}

export function CopyButton({
  value,
  label = "Copy",
  iconOnly = false,
}: {
  value: string
  label?: string
  /** Render only the icon (label stays as the accessible name). */
  iconOnly?: boolean
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
      size={iconOnly ? "icon-xs" : "sm"}
      className="text-xs text-muted-foreground hover:text-foreground"
      aria-label={label}
      onClick={async (e) => {
        e.stopPropagation()
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
        } catch {
          toast.error("Unable to copy. Select and copy the text instead.")
        }
      }}
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Copy className="size-3.5" />
      )}
      {!iconOnly ? (
        <span className="sr-only sm:not-sr-only sm:ml-1">
          {copied ? "Copied" : label}
        </span>
      ) : (
        <span className="sr-only">{copied ? "Copied" : label}</span>
      )}
    </Button>
  )
}

export function TraceField({
  label,
  children,
  mono = false,
}: {
  label: string
  children: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-sm break-words text-foreground",
          mono && "font-mono text-xs leading-5 break-all"
        )}
      >
        {children}
      </dd>
    </div>
  )
}

export function TokenPair({
  input,
  output,
  label = "Input tokens / output tokens",
}: {
  input: number | null
  output: number | null
  label?: string
}) {
  return (
    <span className="text-xs tabular-nums" title={label}>
      <span className="font-medium text-foreground">{formatInt(input)}</span>
      <span className="px-1 text-muted-foreground">in /</span>
      <span className="font-medium text-foreground">{formatInt(output)}</span>
      <span className="pl-1 text-muted-foreground">out</span>
    </span>
  )
}

export function TraceEmpty({
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
      className="flex flex-col items-center justify-center py-16 text-center"
      role={error ? "alert" : "status"}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {error ? (
          <Ban className="size-6 text-destructive" />
        ) : (
          <Route className="size-6" />
        )}
      </span>
      <h2 className="mt-4 text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-1 max-w-md text-sm leading-normal text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export type TraceListItem = MessageTraceItem | CallTraceItem

export function isCallTraceItem(item: TraceListItem): item is CallTraceItem {
  return "provider_model" in item
}
