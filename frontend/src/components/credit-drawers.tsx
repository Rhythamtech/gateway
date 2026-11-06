import * as React from "react"
import {
  IconCheck,
  IconCircleCheckFilled,
  IconCopy,
  IconX,
} from "@tabler/icons-react"

import {
  addProviderCredits,
  addUserCredits,
  ApiError,
  getModelCreditRate,
  resolveCreditUsage,
  setModelCreditRate,
  type CreditAddition,
  type CreditBalance,
  type CreditUsage,
  type ModelCreditRate,
  type ProviderModel,
} from "@/lib/auth"
import {
  CREDIT_MAX_REQUEST_TOKENS,
  CREDIT_REASON_MAX_LENGTH,
  calculateChargePreview,
  chargeDisplayedText,
  formatCredits,
  generateIdempotencyKey,
  isMissingRateError,
  usageStatusLabel,
  validateCreditAmount,
  validateTokenCeiling,
  validateTokensPerCredit,
} from "@/lib/credits"
import { formatTimestampInDeviceZone, parseApiTimestamp } from "@/lib/datetime"
import { useIsMobile } from "@/hooks/use-mobile"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

function formatDateTime(value: string): string {
  const date = parseApiTimestamp(value)
  return date === null ? value : formatTimestampInDeviceZone(date)
}

function DetailRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 text-sm">{children}</span>
    </div>
  )
}

export function UsageStatusBadge({ status }: { status: string }) {
  if (status === "needs_review") {
    return (
      <Badge
        variant="outline"
        className="px-1.5 text-amber-700 dark:text-amber-400"
      >
        {usageStatusLabel(status)}
      </Badge>
    )
  }
  if (status === "settled" || status === "released") {
    return (
      <Badge variant="outline" className="px-1.5 text-muted-foreground">
        <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
        {usageStatusLabel(status)}
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="px-1.5">
      {usageStatusLabel(status)}
    </Badge>
  )
}

function CopyableIdentifier({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1800)
    return () => window.clearTimeout(timer)
  }, [copied])

  return (
    <div className="flex max-w-full items-center justify-between gap-2">
      <span className="min-w-0 font-mono text-xs break-all select-all">
        {value}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
        aria-label={`Copy ${value}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value)
            setCopied(true)
          } catch {
            // no-op if clipboard access fails
          }
        }}
      >
        {copied ? (
          <IconCheck className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
        ) : (
          <IconCopy className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  )
}

export function UsageDetailDrawer({
  usage,
  onClose,
}: {
  usage: CreditUsage
  onClose: () => void
}) {
  const isMobile = useIsMobile()
  const tokensUnknown =
    usage.input_tokens === null || usage.output_tokens === null
  const isUnfinalized =
    usage.status === "reserved" ||
    usage.status === "dispatched" ||
    usage.status === "usage_recorded" ||
    usage.status === "needs_review"

  return (
    <Drawer
      direction={isMobile ? "bottom" : "right"}
      open={true}
      onOpenChange={(open) => !open && onClose()}
    >
      <DrawerContent className="data-[vaul-drawer-direction=bottom]:max-h-[90dvh] data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-lg">
        <DrawerHeader className="shrink-0 border-b">
          <div className="flex items-center justify-between gap-3">
            <DrawerTitle className="flex items-center gap-2">
              Request usage <UsageStatusBadge status={usage.status} />
            </DrawerTitle>
            <DrawerClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                aria-label="Close request usage"
              >
                <IconX className="h-4 w-4" />
              </Button>
            </DrawerClose>
          </div>
          <DrawerDescription>
            Recorded for request {usage.request_id.slice(0, 8)}…
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-6 p-4 md:p-6">
            <section className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <span className="flex items-baseline gap-2">
                  <span className="text-sm text-muted-foreground">Charged</span>
                  <span className="text-2xl font-semibold tabular-nums">
                    {chargeDisplayedText(usage.status, usage.charged_credits)}
                  </span>
                </span>
                <Separator
                  orientation="vertical"
                  className="hidden h-4 self-center sm:block"
                />
                <span className="flex items-baseline gap-2">
                  <span className="text-sm text-muted-foreground">
                    Maximum hold
                  </span>
                  <span className="font-medium tabular-nums">
                    {formatCredits(usage.reserved_credits)}
                  </span>
                </span>
              </div>
              {isUnfinalized ? (
                <p className="text-xs text-muted-foreground">
                  The hold reserved this request&apos;s full allowance up front
                  and can exceed the final charge; the difference is released on
                  settlement.
                </p>
              ) : null}
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Rate and tokens</h3>
              <DetailRow label="Tokens per credit (recorded)">
                <span className="tabular-nums">
                  {formatCredits(usage.tokens_per_credit)}
                </span>
              </DetailRow>
              <DetailRow label="Input tokens">
                <span className="tabular-nums">
                  {usage.input_tokens === null
                    ? "Not reported"
                    : usage.input_tokens.toLocaleString("en-US")}
                </span>
              </DetailRow>
              <DetailRow label="Output tokens">
                <span className="tabular-nums">
                  {usage.output_tokens === null
                    ? "Not reported"
                    : usage.output_tokens.toLocaleString("en-US")}
                </span>
              </DetailRow>
              {tokensUnknown ? (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  The provider did not report usage for this request. Missing
                  usage is never billed from an estimate; the hold stays until
                  it is resolved.
                </p>
              ) : isUnfinalized ? (
                <p className="text-xs text-muted-foreground">
                  At this recorded rate these tokens charge{" "}
                  <span className="tabular-nums">
                    {calculateChargePreview(
                      usage.input_tokens ?? 0,
                      usage.output_tokens ?? 0,
                      usage.tokens_per_credit
                    ) ?? "—"}
                  </span>{" "}
                  credits. The recorded rate applies to this request; the
                  model&apos;s current rate may have changed since.
                </p>
              ) : null}
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Identifiers</h3>
              <DetailRow label="Usage ID">
                <CopyableIdentifier value={usage.id} />
              </DetailRow>
              <DetailRow label="Request ID">
                <CopyableIdentifier value={usage.request_id} />
              </DetailRow>
              <DetailRow label="Applied rate ID">
                <CopyableIdentifier value={usage.rate_id} />
              </DetailRow>
              <DetailRow label="Provider model ID">
                <CopyableIdentifier value={usage.provider_model_id} />
              </DetailRow>
              <DetailRow label="Provider response ID">
                {usage.provider_request_id ? (
                  <CopyableIdentifier value={usage.provider_request_id} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </DetailRow>
              <DetailRow label="API key ID">
                <CopyableIdentifier value={usage.api_key_id} />
              </DetailRow>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Recorded</h3>
              <DetailRow label="Created">
                {formatDateTime(usage.created_at)}
              </DetailRow>
              <DetailRow label="Updated">
                {formatDateTime(usage.updated_at)}
              </DetailRow>
              {usage.status === "needs_review" ? (
                <p className="text-xs text-muted-foreground">
                  A superuser resolves this request from Credit review.
                </p>
              ) : null}
            </section>
          </div>
        </div>
        <DrawerFooter className="shrink-0 border-t pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <DrawerClose asChild>
            <Button variant="outline" className="w-full">
              Close
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

export type CreditFundingTarget =
  | { kind: "provider"; id: string; name: string }
  | { kind: "user"; id: string; name: string }

type FundingSnapshot = {
  amount: string
  reason: string
  idempotencyKey: string
}

export function CreditFundingDrawer({
  target,
  balance,
  onClose,
  onFunded,
}: {
  target: CreditFundingTarget
  balance: CreditBalance | null
  onClose: () => void
  onFunded: () => void
}) {
  const isMobile = useIsMobile()
  const [amount, setAmount] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [snapshot, setSnapshot] = React.useState<FundingSnapshot | null>(null)

  const amountValidation =
    amount.trim() === "" ? null : validateCreditAmount(amount)

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const validated = validateCreditAmount(amount)
    if (!validated.valid) {
      setError(validated.error)
      return
    }
    const nextReason = reason.trim()
    if (!nextReason) {
      setError("Enter a reason for this addition.")
      return
    }
    if (nextReason.length > CREDIT_REASON_MAX_LENGTH) {
      setError(
        `Reasons are limited to ${CREDIT_REASON_MAX_LENGTH.toLocaleString("en-US")} characters.`
      )
      return
    }

    const unchanged =
      snapshot !== null &&
      snapshot.amount === validated.normalized &&
      snapshot.reason === nextReason
    const idempotencyKey = unchanged
      ? (snapshot as FundingSnapshot).idempotencyKey
      : generateIdempotencyKey()
    setSnapshot({
      amount: validated.normalized,
      reason: nextReason,
      idempotencyKey,
    })

    setPending(true)
    setError(null)

    const input: CreditAddition = {
      credits: validated.normalized,
      idempotency_key: idempotencyKey,
      reason: nextReason,
    }

    try {
      if (target.kind === "provider") {
        await addProviderCredits(target.id, input)
      } else {
        await addUserCredits(target.id, input)
      }
      onFunded()
    } catch (requestError) {
      if (requestError instanceof ApiError) {
        setError(requestError.message)
      } else {
        setError(
          "The request did not complete. If it was applied anyway, submitting the same amount and reason again reuses the same idempotency key and cannot add credits twice."
        )
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <Drawer
      direction={isMobile ? "bottom" : "right"}
      open={true}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DrawerContent>
        <DrawerHeader className="shrink-0 gap-1 border-b">
          <DrawerTitle>Add credits</DrawerTitle>
          <DrawerDescription>
            {target.kind === "provider"
              ? `Add credits to the provider balance for “${target.name}”.`
              : `Add credits to the balance for “${target.name}”.`}
          </DrawerDescription>
        </DrawerHeader>
        <form
          id="credit-funding-form"
          className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4 text-sm"
          onSubmit={handleSubmit}
        >
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">Current remaining</span>
            {balance ? (
              <span className="text-lg font-semibold tabular-nums">
                {formatCredits(balance.remaining_credits)}
              </span>
            ) : (
              <Skeleton className="h-6 w-32" />
            )}
            {balance ? (
              <span className="text-xs text-muted-foreground">
                In use{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {formatCredits(balance.reserved_credits)}
                </span>
              </span>
            ) : null}
          </div>
          <div className="flex flex-col gap-3">
            <Label htmlFor="credit-funding-amount">Credits to add</Label>
            <Input
              id="credit-funding-amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Exact decimal amount with at most six decimal places.
            </p>
            {amountValidation?.valid ? (
              <p className="text-xs text-muted-foreground">
                Adds{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {formatCredits(amountValidation.normalized)}
                </span>{" "}
                credits to the current balance.
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-3">
            <Label htmlFor="credit-funding-reason">Reason</Label>
            <Textarea
              id="credit-funding-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={CREDIT_REASON_MAX_LENGTH}
              rows={3}
              placeholder="Why these credits are being added"
            />
            <p className="text-xs text-muted-foreground">
              Recorded in the credit history for this addition.
            </p>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </form>
        <DrawerFooter
          className="shrink-0 border-t"
          style={{
            paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
          }}
        >
          <Button type="submit" form="credit-funding-form" disabled={pending}>
            {pending ? "Adding…" : "Add credits"}
          </Button>
          <DrawerClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

type RateLoadState =
  | { phase: "loading" }
  | { phase: "missing" }
  | { phase: "loaded"; rate: ModelCreditRate }
  | { phase: "error"; message: string }

export function ModelRateDrawer({
  model,
  onClose,
  onSaved,
}: {
  model: ProviderModel
  onClose: () => void
  onSaved: (rate: ModelCreditRate) => void
}) {
  const isMobile = useIsMobile()
  const [loadState, setLoadState] = React.useState<RateLoadState>({
    phase: "loading",
  })
  const [loadTick, setLoadTick] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    getModelCreditRate(model.id)
      .then((rate) => {
        if (cancelled) return
        setLoadState({ phase: "loaded", rate })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (isMissingRateError(error)) {
          setLoadState({ phase: "missing" })
        } else {
          setLoadState({
            phase: "error",
            message:
              error instanceof Error
                ? error.message
                : "Unable to load the credit rate.",
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [model.id, loadTick])

  const isEdit = loadState.phase === "loaded"

  return (
    <Drawer
      direction={isMobile ? "bottom" : "right"}
      open={true}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DrawerContent>
        <DrawerHeader className="shrink-0 gap-1 border-b">
          <DrawerTitle>
            {isEdit ? "Edit credit rate" : "Configure credit rate"}
          </DrawerTitle>
          <DrawerDescription className="flex flex-col gap-0.5">
            <span>{model.model_name}</span>
            <span className="font-mono text-xs">{model.model_id}</span>
          </DrawerDescription>
        </DrawerHeader>
        {loadState.phase === "loading" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : loadState.phase === "error" ? (
          <div className="flex min-h-0 flex-1 flex-col items-start gap-2 px-4 py-4">
            <p className="text-sm text-destructive" role="alert">
              {loadState.message}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoadState({ phase: "loading" })
                setLoadTick((tick) => tick + 1)
              }}
            >
              Try again
            </Button>
          </div>
        ) : (
          <ModelRateForm
            key={isEdit ? `v${loadState.rate.version}` : "missing"}
            model={model}
            existing={isEdit ? loadState.rate : null}
            onSaved={onSaved}
          />
        )}
      </DrawerContent>
    </Drawer>
  )
}

type RateFieldErrors = {
  tokensPerCredit?: string
  maxRequestTokens?: string
}

function ModelRateForm({
  model,
  existing,
  onSaved,
}: {
  model: ProviderModel
  existing: ModelCreditRate | null
  onSaved: (rate: ModelCreditRate) => void
}) {
  const [tokensPerCredit, setTokensPerCredit] = React.useState(
    () => existing?.tokens_per_credit ?? ""
  )
  const [maxRequestTokens, setMaxRequestTokens] = React.useState(() =>
    existing?.max_request_tokens == null ? "" : String(existing.max_request_tokens)
  )
  const [fieldErrors, setFieldErrors] = React.useState<RateFieldErrors>({})
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const parsedRate = validateTokensPerCredit(tokensPerCredit)
  const parsedRequest = maxRequestTokens.trim()
    ? validateTokenCeiling(maxRequestTokens, CREDIT_MAX_REQUEST_TOKENS)
    : null

  const exampleCharge = parsedRate.valid
    ? calculateChargePreview(1000, 0, parsedRate.normalized)
    : null
  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!parsedRate.valid) {
      setFieldErrors({ tokensPerCredit: parsedRate.error })
      return
    }
    if (parsedRequest && !parsedRequest.valid) {
      setFieldErrors({ maxRequestTokens: parsedRequest.error })
      return
    }

    setPending(true)
    setError(null)
    setFieldErrors({})

    try {
      onSaved(
        await setModelCreditRate(model.id, {
          tokens_per_credit: parsedRate.normalized,
          max_request_tokens: parsedRequest?.tokens ?? null,
        })
      )
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : "Unable to save the credit rate."
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <form
        id="model-rate-form"
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4 text-sm"
        onSubmit={handleSubmit}
      >
        <div className="flex flex-col gap-3">
          <Label htmlFor="model-rate-tokens-per-credit">
            Tokens per credit
          </Label>
          <Input
            id="model-rate-tokens-per-credit"
            inputMode="decimal"
            value={tokensPerCredit}
            onChange={(event) => setTokensPerCredit(event.target.value)}
            placeholder="10"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            Input plus output tokens divided by this value charge one credit.
            The same rate applies to both.
          </p>
          {fieldErrors.tokensPerCredit ? (
            <p className="text-xs text-destructive" role="alert">
              {fieldErrors.tokensPerCredit}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-3">
          <Label htmlFor="model-rate-max-request-tokens">
            Total Token Ceiling (optional)
          </Label>
          <Input
            id="model-rate-max-request-tokens"
            inputMode="numeric"
            value={maxRequestTokens}
            onChange={(event) => setMaxRequestTokens(event.target.value)}
            placeholder="Automatic"
          />
          <p className="text-xs text-muted-foreground">
            Leave blank to let the gateway size each reservation. Set a ceiling
            if this model has a known limit on input plus output.
          </p>
          {fieldErrors.maxRequestTokens ? (
            <p className="text-xs text-destructive" role="alert">
              {fieldErrors.maxRequestTokens}
            </p>
          ) : null}
        </div>
        {exampleCharge !== null ? (
          <div className="flex flex-col gap-1 rounded-md border p-3 text-xs text-muted-foreground">
            <span>
              Example: a 1,000-token request charges{" "}
              <span className="font-medium text-foreground tabular-nums">
                {exampleCharge}
              </span>{" "}
              credits at this rate.
            </span>
          </div>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </form>
      <DrawerFooter
        className="shrink-0 border-t"
        style={{
          paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
        }}
      >
        <div className="flex flex-col gap-1">
          {existing ? (
            <p className="text-xs text-muted-foreground">
              Version {existing.version} · recorded{" "}
              {formatDateTime(existing.created_at)}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Saved changes apply to new requests. In-flight requests keep the
            rate they were admitted with.
          </p>
        </div>
        <Button type="submit" form="model-rate-form" disabled={pending}>
          {pending ? "Saving…" : existing ? "Save changes" : "Configure rate"}
        </Button>
        <DrawerClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DrawerClose>
      </DrawerFooter>
    </>
  )
}

function integerTokenValue(
  value: string
): { valid: true; tokens: number } | { valid: false; error: string } {
  const trimmed = value.trim()
  if (trimmed === "") {
    return { valid: false, error: "Enter the reported token count." }
  }
  if (!/^\d+$/.test(trimmed)) {
    return { valid: false, error: "Enter a nonnegative whole number." }
  }
  const tokens = Number(trimmed)
  if (!Number.isSafeInteger(tokens) || tokens > 10_000_000) {
    return {
      valid: false,
      error: "Enter a whole number of at most 10,000,000 tokens.",
    }
  }
  return { valid: true, tokens }
}

export function ReviewEvidenceDrawer({
  usage,
  onClose,
  onResolved,
}: {
  usage: CreditUsage
  onClose: () => void
  onResolved: () => void
}) {
  const isMobile = useIsMobile()
  const [action, setAction] = React.useState<"settle" | "release">("settle")
  const [inputTokens, setInputTokens] = React.useState(() =>
    usage.input_tokens === null ? "" : String(usage.input_tokens)
  )
  const [outputTokens, setOutputTokens] = React.useState(() =>
    usage.output_tokens === null ? "" : String(usage.output_tokens)
  )
  const [reason, setReason] = React.useState("")
  const [confirmRelease, setConfirmRelease] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<{
    inputTokens?: string
    outputTokens?: string
    reason?: string
    confirm?: string
  }>({})
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const needsReview = usage.status === "needs_review"
  const parsedInput = integerTokenValue(inputTokens)
  const parsedOutput = integerTokenValue(outputTokens)

  function resetForm() {
    setAction("settle")
    setInputTokens(
      usage.input_tokens === null ? "" : String(usage.input_tokens)
    )
    setOutputTokens(
      usage.output_tokens === null ? "" : String(usage.output_tokens)
    )
    setReason("")
    setConfirmRelease(false)
    setFieldErrors({})
    setError(null)
  }

  async function handleResolve() {
    const nextErrors: typeof fieldErrors = {}
    if (action === "settle") {
      if (!parsedInput.valid) nextErrors.inputTokens = parsedInput.error
      if (!parsedOutput.valid) nextErrors.outputTokens = parsedOutput.error
    }
    if (reason.trim() === "") {
      nextErrors.reason = "A reason is required for the audit record."
    }
    if (action === "release" && !confirmRelease) {
      nextErrors.confirm = "Confirm that no charge should occur."
    }
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors)
      return
    }
    setFieldErrors({})
    setError(null)
    setPending(true)

    if (action === "settle") {
      if (!parsedInput.valid || !parsedOutput.valid) return
      try {
        await resolveCreditUsage(usage.id, {
          action: "settle",
          input_tokens: parsedInput.tokens,
          output_tokens: parsedOutput.tokens,
          reason: reason.trim(),
        })
        onResolved()
      } catch (requestError) {
        if (requestError instanceof ApiError && requestError.status === 409) {
          setError(
            "This record was updated or resolved by another session. Please refresh the queue to assess its updated status."
          )
        } else {
          setError(
            requestError instanceof ApiError
              ? requestError.message
              : "Unable to resolve this usage."
          )
        }
      } finally {
        setPending(false)
      }
      return
    }

    try {
      await resolveCreditUsage(usage.id, {
        action: "release",
        reason: reason.trim(),
      })
      onResolved()
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 409) {
        setError(
          "This record was updated or resolved by another session. Please refresh the queue to assess its updated status."
        )
      } else {
        setError(
          requestError instanceof ApiError
            ? requestError.message
            : "Unable to resolve this usage."
        )
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <Drawer
      direction={isMobile ? "bottom" : "right"}
      open={true}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DrawerContent className="data-[vaul-drawer-direction=bottom]:max-h-[90dvh] data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-lg">
        <DrawerHeader className="shrink-0 gap-1 border-b">
          <div className="flex items-center justify-between gap-3">
            <DrawerTitle className="flex items-center gap-2">
              Review evidence <UsageStatusBadge status={usage.status} />
            </DrawerTitle>
            <DrawerClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                aria-label="Close review evidence"
              >
                <IconX className="h-4 w-4" />
              </Button>
            </DrawerClose>
          </div>
          <DrawerDescription>
            Request {usage.request_id.slice(0, 8)}… ·{" "}
            {formatDateTime(usage.created_at)}
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-6 p-4 md:p-6">
            <section className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <span className="flex items-baseline gap-2">
                  <span className="text-sm text-muted-foreground">
                    Maximum hold
                  </span>
                  <span className="text-2xl font-semibold tabular-nums">
                    {formatCredits(usage.reserved_credits)}
                  </span>
                </span>
                <Separator
                  orientation="vertical"
                  className="hidden h-4 self-center sm:block"
                />
                <span className="flex items-baseline gap-2">
                  <span className="text-sm text-muted-foreground">Charged</span>
                  <span className="font-medium tabular-nums">
                    {chargeDisplayedText(usage.status, usage.charged_credits)}
                  </span>
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                The hold reserved this request&apos;s full allowance up front
                and can exceed the final charge; the difference is released on
                settlement.
              </p>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Rate snapshot</h3>
              <DetailRow label="Tokens per credit (recorded)">
                <span className="tabular-nums">
                  {formatCredits(usage.tokens_per_credit)}
                </span>
              </DetailRow>
              <DetailRow label="Reserved token allowance">
                <span className="tabular-nums">
                  {usage.max_request_tokens.toLocaleString("en-US")}
                </span>
              </DetailRow>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Reported usage</h3>
              <DetailRow label="Input tokens">
                <span className="tabular-nums">
                  {usage.input_tokens === null
                    ? "Not reported"
                    : usage.input_tokens.toLocaleString("en-US")}
                </span>
              </DetailRow>
              <DetailRow label="Output tokens">
                <span className="tabular-nums">
                  {usage.output_tokens === null
                    ? "Not reported"
                    : usage.output_tokens.toLocaleString("en-US")}
                </span>
              </DetailRow>
              {usage.input_tokens === null || usage.output_tokens === null ? (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  The provider did not report usage for this request. The
                  backend does not automatically retrieve missing provider
                  usage; settle with the counts you can verify, or release the
                  hold.
                </p>
              ) : null}
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Identifiers</h3>
              <DetailRow label="Request ID">
                <CopyableIdentifier value={usage.request_id} />
              </DetailRow>
              <DetailRow label="Provider response ID">
                {usage.provider_request_id ? (
                  <CopyableIdentifier value={usage.provider_request_id} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </DetailRow>
              <DetailRow label="User ID">
                <CopyableIdentifier value={usage.user_id} />
              </DetailRow>
              <DetailRow label="Provider ID">
                <CopyableIdentifier value={usage.provider_id} />
              </DetailRow>
              <DetailRow label="Provider model ID">
                <CopyableIdentifier value={usage.provider_model_id} />
              </DetailRow>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Recorded</h3>
              <DetailRow label="Created">
                {formatDateTime(usage.created_at)}
              </DetailRow>
              <DetailRow label="Updated">
                {formatDateTime(usage.updated_at)}
              </DetailRow>
              {usage.status !== "needs_review" ? (
                <p className="text-xs text-muted-foreground">
                  This usage was already resolved
                  {usage.resolved_by ? " by a superuser" : ""}. No further
                  action is available.
                </p>
              ) : null}
            </section>

            {needsReview ? (
              <section className="flex flex-col gap-3 border-t pt-4">
                <h3 className="text-sm font-semibold">Resolve</h3>
                <Tabs
                  value={action}
                  onValueChange={(next) => {
                    setAction(next as "settle" | "release")
                    setFieldErrors({})
                    setError(null)
                  }}
                >
                  <TabsList className="w-full">
                    <TabsTrigger value="settle" className="flex-1">
                      Settle
                    </TabsTrigger>
                    <TabsTrigger value="release" className="flex-1">
                      Release
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                <p className="text-xs text-muted-foreground">
                  {action === "settle"
                    ? `Settles verified token counts at ${formatCredits(usage.tokens_per_credit)} tokens/credit. Unused hold is returned to user and provider.`
                    : `Releases the full hold (${formatCredits(usage.reserved_credits)} credits) back to user and provider with zero charge.`}
                </p>

                {action === "settle" ? (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="review-input-tokens">Input tokens</Label>
                      <Input
                        id="review-input-tokens"
                        inputMode="numeric"
                        value={inputTokens}
                        onChange={(event) => setInputTokens(event.target.value)}
                      />
                      {fieldErrors.inputTokens ? (
                        <p className="text-xs text-destructive">
                          {fieldErrors.inputTokens}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          The verified input token count reported for this
                          request.
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="review-output-tokens">
                        Output tokens
                      </Label>
                      <Input
                        id="review-output-tokens"
                        inputMode="numeric"
                        value={outputTokens}
                        onChange={(event) =>
                          setOutputTokens(event.target.value)
                        }
                      />
                      {fieldErrors.outputTokens ? (
                        <p className="text-xs text-destructive">
                          {fieldErrors.outputTokens}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          The verified output token count reported for this
                          request.
                        </p>
                      )}
                    </div>
                    {parsedInput.valid && parsedOutput.valid ? (
                      <p className="text-xs text-muted-foreground">
                        Settlement charges{" "}
                        <span className="tabular-nums">
                          {calculateChargePreview(
                            parsedInput.tokens,
                            parsedOutput.tokens,
                            usage.tokens_per_credit
                          ) ?? "—"}
                        </span>{" "}
                        credits against the recorded rate, from both the user
                        and provider holds.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="review-release-confirm"
                        checked={confirmRelease}
                        onCheckedChange={(checked) => {
                          setConfirmRelease(Boolean(checked))
                          setFieldErrors((prev) => ({
                            ...prev,
                            confirm: undefined,
                          }))
                        }}
                      />
                      <Label
                        htmlFor="review-release-confirm"
                        className="text-sm leading-snug font-normal"
                      >
                        I confirm no charge should occur for this request and
                        that releasing returns the full hold to both balances.
                      </Label>
                    </div>
                    {fieldErrors.confirm ? (
                      <p className="text-xs text-destructive">
                        {fieldErrors.confirm}
                      </p>
                    ) : null}
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="review-reason">Reason</Label>
                  <Textarea
                    id="review-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Recorded in the audit trail for this decision."
                    maxLength={1000}
                  />
                  {fieldErrors.reason ? (
                    <p className="text-xs text-destructive">
                      {fieldErrors.reason}
                    </p>
                  ) : null}
                </div>

                {error ? (
                  <p className="text-sm text-destructive" role="alert">
                    {error}
                  </p>
                ) : null}
              </section>
            ) : null}
          </div>
        </div>
        <DrawerFooter className="border-t pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          {needsReview ? (
            <>
              <Button onClick={handleResolve} disabled={pending}>
                {pending
                  ? "Resolving…"
                  : action === "settle"
                    ? "Settle usage"
                    : "Release hold"}
              </Button>
              <Button variant="outline" onClick={resetForm} disabled={pending}>
                Reset
              </Button>
            </>
          ) : null}
          <DrawerClose asChild>
            <Button variant={needsReview ? "outline" : "default"}>Close</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
