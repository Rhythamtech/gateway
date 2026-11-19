import * as React from "react"
import { CircleAlert, ArrowRight, X } from "lucide-react"
import { formatCredits } from "@/lib/credits"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
export function AccountCreditAlert() {
  const [dismissed, setDismissed] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<{
    warning: string | null
    available: string
  } | null>(null)
  React.useEffect(() => {
    let previousWarning: string | null = null
    function changed(event: Event) {
      const next = (
        event as CustomEvent<{ warning: string | null; available: string }>
      ).detail
      if (next.warning !== previousWarning) setDismissed(null)
      previousWarning = next.warning
      setStatus(
        (event as CustomEvent<{ warning: string | null; available: string }>)
          .detail
      )
    }
    window.addEventListener("gateway:credit-status", changed)
    return () => window.removeEventListener("gateway:credit-status", changed)
  }, [])
  if (!status?.warning || dismissed === status.warning) return null
  return (
    <div className="px-4 pt-4 md:px-6">
      <Alert
        variant={status.warning === "exhausted" ? "credit" : "notice"}
        className="grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3"
        role="status"
      >
        <span className="notice-icon" data-severity={status.warning}>
          <CircleAlert aria-hidden="true" />
        </span>
        <AlertDescription className="col-start-2 block min-w-0">
          <p>
            <strong
              className={
                status.warning === "exhausted" ? "text-destructive" : undefined
              }
            >
              {status.warning === "exhausted"
                ? "No credits available"
                : "Your credits are running low"}
            </strong>
            <span>
              {" "}
              · You have {formatCredits(status.available)} available credits.
            </span>
          </p>
        </AlertDescription>
        <div className="col-start-2 flex flex-wrap items-center gap-2 pt-2 sm:col-start-3 sm:row-start-1 sm:pt-0">
          <Button asChild variant="outline" size="sm" className="rounded-full">
            <a href="/dashboard/credits">
              Manage credits
              <ArrowRight data-icon="inline-end" />
            </a>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDismissed(status.warning)}
            aria-label="Dismiss credit warning"
          >
            <X />
          </Button>
        </div>
      </Alert>
    </div>
  )
}
