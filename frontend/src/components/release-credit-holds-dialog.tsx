import * as React from "react"
import { ChevronDown } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, resolveCreditUsage, type CreditUsage } from "@/lib/auth"
import {
  CREDIT_REASON_MAX_LENGTH,
  creditReviewReason,
  formatCredits,
} from "@/lib/credits"

export function ReleaseCreditHoldsDialog({
  holds,
  onClose,
  onReleased,
}: {
  holds: CreditUsage[]
  onClose: () => void
  onReleased: (ids: string[]) => void
}) {
  const titleRef = React.useRef<HTMLHeadingElement>(null)
  const [remaining, setRemaining] = React.useState(holds)
  const [reason, setReason] = React.useState(() =>
    holds.length === 1
      ? `Release the credit hold for request ${holds[0].request_id}.`
      : `Release ${holds.length} credit holds after review.`
  )
  const [confirmed, setConfirmed] = React.useState(false)
  const [progress, setProgress] = React.useState<number | null>(null)
  const [error, setError] = React.useState("")
  const pending = progress !== null
  const singleHold = remaining.length === 1 ? remaining[0] : null

  async function release() {
    setError("")
    setProgress(0)
    const released: string[] = []
    const failed: CreditUsage[] = []
    let failure = ""

    for (const hold of remaining) {
      try {
        await resolveCreditUsage(hold.id, {
          action: "release",
          reason: reason.trim(),
        })
        released.push(hold.id)
      } catch (requestError) {
        failed.push(hold)
        if (!failure) {
          failure =
            requestError instanceof ApiError
              ? requestError.message
              : "The release could not be confirmed."
        }
      }
      setProgress(released.length + failed.length)
    }

    onReleased(released)
    if (released.length) {
      toast.success(
        released.length === 1
          ? "Credit hold released."
          : `${released.length} credit holds released.`
      )
    }
    if (failed.length === 0) {
      onClose()
    } else {
      setRemaining(failed)
      setError(
        `${failure} ${failed.length} ${failed.length === 1 ? "hold remains" : "holds remain"} in this batch.`
      )
      setProgress(null)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-hidden"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          titleRef.current?.focus()
        }}
      >
        <DialogHeader className="shrink-0 pr-12">
          <DialogTitle ref={titleRef} tabIndex={-1} className="outline-none">
            {singleHold
              ? "Release credit hold"
              : `Release ${remaining.length} credit holds`}
          </DialogTitle>
          <DialogDescription>
            {singleHold
              ? `${formatCredits(singleHold.reserved_credits)} credits return to both balances. The request is charged zero credits.`
              : "Each hold returns to the user and provider balances with zero charge."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="flex flex-col gap-3 p-4">
            {singleHold && (
              <dl className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                <dt>Request ID</dt>
                <dd className="font-mono text-xs wrap-anywhere">
                  {singleHold.request_id}
                </dd>
                <dt>User ID</dt>
                <dd className="font-mono text-xs wrap-anywhere">
                  {singleHold.user_id}
                </dd>
                <dt>Provider model ID</dt>
                <dd className="font-mono text-xs wrap-anywhere">
                  {singleHold.provider_model_id}
                </dd>
                <dt>Review reason</dt>
                <dd className="wrap-anywhere">
                  {creditReviewReason(singleHold.reason)}
                </dd>
              </dl>
            )}
            <FieldGroup className="gap-3">
              <Field data-disabled={pending}>
                <FieldLabel htmlFor="release-holds-reason">
                  Audit reason
                </FieldLabel>
                <Textarea
                  id="release-holds-reason"
                  value={reason}
                  disabled={pending}
                  maxLength={CREDIT_REASON_MAX_LENGTH}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
              <Field orientation="horizontal" data-disabled={pending}>
                <Checkbox
                  id="release-holds-confirm"
                  checked={confirmed}
                  disabled={pending}
                  onCheckedChange={(checked) => setConfirmed(checked === true)}
                />
                <FieldLabel htmlFor="release-holds-confirm">
                  {singleHold
                    ? "I verified that no charge is due for this request."
                    : "I verified that no charge is due for every request in this batch."}
                </FieldLabel>
              </Field>
            </FieldGroup>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {pending && (
              <p role="status" className="text-sm">
                Processed {progress} of {remaining.length}
              </p>
            )}
            {!singleHold && (
              <Collapsible className="flex flex-col items-start gap-2">
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="sm" className="group">
                    Request details
                    <ChevronDown
                      data-icon="inline-end"
                      className="group-data-[state=open]:rotate-180"
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="w-full">
                  <ul
                    aria-label="Holds to release"
                    tabIndex={0}
                    className="max-h-36 divide-y overflow-y-auto overscroll-contain rounded-md border px-3 text-sm"
                  >
                    {remaining.map((hold) => (
                      <li
                        key={hold.id}
                        className="flex flex-col gap-0.5 py-1.5"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className="font-mono text-xs wrap-anywhere">
                            {hold.request_id}
                          </span>
                          <span className="tabular-nums">
                            {formatCredits(hold.reserved_credits)} credits
                          </span>
                        </div>
                        <p className="text-xs wrap-anywhere text-muted-foreground">
                          {creditReviewReason(hold.reason)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={() => void release()}
            disabled={pending || !confirmed || !reason.trim()}
          >
            {pending
              ? "Releasing…"
              : singleHold
                ? "Release hold"
                : `Release ${remaining.length} holds`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
