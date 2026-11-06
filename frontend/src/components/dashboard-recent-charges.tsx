import * as React from "react"
import { ArrowUpRight, ReceiptText, RefreshCw } from "lucide-react"
import { listMyCreditUsage, type CreditUsage } from "@/lib/auth"
import { chargeDisplayedText } from "@/lib/credits"
import { formatTimestampInDeviceZone, parseApiTimestamp } from "@/lib/datetime"
import {
  UsageDetailDrawer,
  UsageStatusBadge,
} from "@/components/credit-drawers"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

const shortId = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`
const timestamp = (value: string) => {
  const date = parseApiTimestamp(value)
  return date ? formatTimestampInDeviceZone(date) : value
}

/** Latest personal ledger records; intentionally independent of analytics filters. */
export default function DashboardRecentCharges({
  refreshTick,
}: {
  refreshTick: number
}) {
  const [retry, setRetry] = React.useState(0)
  const [result, setResult] = React.useState<{
    key: string
    items: CreditUsage[]
    at: Date
  } | null>(null)
  const [failure, setFailure] = React.useState<{
    key: string
    message: string
  } | null>(null)
  const [selected, setSelected] = React.useState<CreditUsage | null>(null)
  const opener = React.useRef<HTMLButtonElement | null>(null)
  const key = `${refreshTick}:${retry}`
  const error = failure?.key === key ? failure.message : null
  const loading = result?.key !== key && !error
  React.useEffect(() => {
    let cancelled = false
    listMyCreditUsage({ page: 1, pageSize: 5 })
      .then((value) => {
        if (!cancelled) setResult({ key, items: value.items, at: new Date() })
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setFailure({
            key,
            message:
              reason instanceof Error
                ? reason.message
                : "Recent charges could not be loaded.",
          })
      })
    return () => {
      cancelled = true
    }
  }, [key])
  return (
    <section
      aria-label="Recent account charges"
      aria-busy={loading}
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card"
    >
      <header className="border-b p-4 sm:p-5">
        <h3 className="flex items-center gap-2 font-semibold">
          <ReceiptText className="size-4" />
          Recent account charges
        </h3>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Latest five personal usage records, across all keys and dates.
          Independent of analytics filters.
        </p>
      </header>
      {error && (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 border-b p-4"
        >
          <p className="text-xs text-destructive">
            {error}
            {result ? " Showing the last loaded records." : ""}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRetry((value) => value + 1)}
          >
            <RefreshCw data-icon="inline-start" />
            Try again
          </Button>
        </div>
      )}
      {loading && !result ? (
        <div
          className="flex flex-col gap-4 p-5"
          role="status"
          aria-label="Loading recent charges"
        >
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : result?.items.length ? (
        <ul className="divide-y">
          {result.items.map((item) => {
            const charge = chargeDisplayedText(
              item.status,
              item.charged_credits
            )
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex w-full flex-col gap-2 px-4 py-4 text-left outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-5"
                  aria-label={`Inspect charge for request ${item.request_id}`}
                  onClick={(event) => {
                    opener.current = event.currentTarget
                    setSelected(item)
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs" title={item.request_id}>
                      {shortId(item.request_id)}
                    </span>
                    <ArrowUpRight className="size-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <UsageStatusBadge status={item.status} />
                    <span className="text-sm font-semibold tabular-nums">
                      {charge}
                      {charge !== "Not finalized" && (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          credits
                        </span>
                      )}
                    </span>
                  </div>
                  <time
                    dateTime={item.created_at}
                    className="text-xs text-muted-foreground"
                  >
                    {timestamp(item.created_at)}
                  </time>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        result && (
          <div className="flex flex-col items-start gap-3 px-5 py-8">
            <ReceiptText className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">No inference charges yet</p>
            <p className="text-xs leading-5 text-muted-foreground">
              Send a Playground request to see its usage record and charge state
              here.
            </p>
            <Button asChild variant="outline" size="sm">
              <a href="/dashboard/playground">Open Playground</a>
            </Button>
          </div>
        )
      )}
      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs sm:px-5">
        <span className="text-muted-foreground" role="status">
          {loading
            ? "Refreshing…"
            : result
              ? `Loaded ${result.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : ""}
        </span>
        <Button asChild variant="link" size="sm">
          <a href="/dashboard/credits">
            View credit ledger
            <ArrowUpRight data-icon="inline-end" />
          </a>
        </Button>
      </footer>
      {selected && (
        <UsageDetailDrawer
          usage={selected}
          onClose={() => {
            setSelected(null)
            window.requestAnimationFrame(() => {
              if (opener.current?.isConnected) opener.current.focus()
            })
          }}
        />
      )}
    </section>
  )
}
