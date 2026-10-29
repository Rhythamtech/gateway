import * as React from "react"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  ApiError,
  getProviderBudget,
  getSystemBudget,
  type CreditTopUpInput,
  type ProviderBudget,
  type SystemBudget,
} from "@/lib/auth"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function formatInt(value: number) {
  return value.toLocaleString("en-US")
}

function BudgetChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-muted p-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-sm tabular-nums">{value}</span>
    </div>
  )
}

export type TopUpResultSummary = {
  headline: string
  lines: { label: string; value: string; mono?: boolean }[]
}

type TopUpFormDrawerProps = {
  title: string
  description: string
  submitLabel: string
  pendingLabel: string
  onSubmit: (input: CreditTopUpInput) => Promise<TopUpResultSummary>
  onSubmitted: () => void
  onClose: () => void
}

// Shared form for the three superuser top-up operations (system funding,
// provider allocation, user wallet credit). Validation mirrors the
// documented backend constraints: positive integer amount, nonblank reason
// (≤255), unique idempotency key (8–128). Backend errors (409 duplicate key /
// insufficient funds, 404, 422) surface inline while keeping entered values.
export function TopUpFormDrawer({
  title,
  description,
  submitLabel,
  pendingLabel,
  onSubmit,
  onSubmitted,
  onClose,
}: TopUpFormDrawerProps) {
  const isMobile = useIsMobile()
  const amountId = React.useId()
  const reasonId = React.useId()
  const keyId = React.useId()

  const [amount, setAmount] = React.useState("")
  const [reason, setReason] = React.useState("")
  const [idempotencyKey, setIdempotencyKey] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const [result, setResult] = React.useState<TopUpResultSummary | null>(null)

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()

    const amountText = amount.trim()
    // Whole positive integer credits only ("0", decimals, signs, escaped
    // notations are rejected; safe-integer range guards float drift).
    if (!/^[1-9]\d*$/.test(amountText)) {
      setError("Enter a whole number of credits (at least 1).")
      return
    }
    const amountCredits = Number(amountText)
    if (!Number.isSafeInteger(amountCredits)) {
      setError("Enter a smaller whole number of credits.")
      return
    }

    const reasonText = reason.trim()
    if (reasonText.length === 0 || reasonText.length > 255) {
      setError("Enter a reason (up to 255 characters).")
      return
    }

    const keyText = idempotencyKey.trim()
    if (keyText.length < 8 || keyText.length > 128) {
      setError("Enter an idempotency key of 8–128 characters.")
      return
    }

    setPending(true)
    setError(null)

    try {
      const summary = await onSubmit({
        amount_credits: amountCredits,
        reason: reasonText,
        idempotency_key: keyText,
      })
      onSubmitted()
      setResult(summary)
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : "The top-up could not be recorded."
      )
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
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-2 text-sm">
          {result === null ? (
            <>
              <form
                id="top-up-form"
                className="flex flex-col gap-4"
                onSubmit={handleSubmit}
              >
                <div className="flex flex-col gap-2">
                  <Label htmlFor={amountId}>Amount (credits)</Label>
                  <Input
                    id={amountId}
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    placeholder="e.g. 500"
                    autoComplete="off"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    disabled={pending}
                  />
                  <p className="text-xs text-muted-foreground">
                    Whole positive integer credits. Credits are operational, not
                    currency.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={reasonId}>Reason</Label>
                  <Input
                    id={reasonId}
                    maxLength={255}
                    autoComplete="off"
                    placeholder="Why these credits are being recorded"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    disabled={pending}
                  />
                  <p className="text-xs text-muted-foreground">
                    Required; shown alongside the transaction (≤255 characters).
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={keyId}>Idempotency key</Label>
                  <Input
                    id={keyId}
                    maxLength={128}
                    autoComplete="off"
                    className="font-mono"
                    placeholder="A unique key for this operation"
                    value={idempotencyKey}
                    onChange={(event) => setIdempotencyKey(event.target.value)}
                    disabled={pending}
                  />
                  <p className="text-xs text-muted-foreground">
                    Unique per operation (8–128 characters). Reusing a key from
                    an earlier top-up is rejected as a duplicate instead of
                    double-crediting.
                  </p>
                </div>
                {error !== null ? (
                  <p className="text-sm text-destructive" role="alert">
                    {error}
                  </p>
                ) : null}
              </form>
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium">{result.headline}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {result.lines.map((line) => (
                  <div
                    key={line.label}
                    className="flex min-w-0 flex-col gap-1 rounded-lg border bg-muted p-2"
                  >
                    <span className="text-xs text-muted-foreground">
                      {line.label}
                    </span>
                    <span
                      className={
                        line.mono
                          ? "font-mono text-xs break-all"
                          : "font-mono text-sm tabular-nums"
                      }
                    >
                      {line.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <DrawerFooter
          className="shrink-0 border-t"
          style={{
            paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
          }}
        >
          {result === null ? (
            <div className="flex w-full items-center justify-between gap-2">
              <DrawerClose asChild>
                <Button type="button" variant="outline" disabled={pending}>
                  Cancel
                </Button>
              </DrawerClose>
              <Button type="submit" form="top-up-form" disabled={pending}>
                {pending ? pendingLabel : submitLabel}
              </Button>
            </div>
          ) : (
            <DrawerClose asChild>
              <Button type="button">Done</Button>
            </DrawerClose>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

export function SystemBudgetCard({
  reloadTick,
  onFund,
}: {
  reloadTick: number
  onFund: () => void
}) {
  const [budget, setBudget] = React.useState<SystemBudget | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false

    getSystemBudget()
      .then((result) => {
        if (cancelled) return
        setBudget(result)
        setError(null)
      })
      .catch((requestError: unknown) => {
        if (cancelled) return
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load the system budget."
        )
      })

    return () => {
      cancelled = true
    }
  }, [reloadTick, attempt])

  function retryLoad() {
    setBudget(null)
    setAttempt((current) => current + 1)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="text-base">System credit budget</CardTitle>
            <CardDescription>
              Funding adds new credits to the unallocated pool; allocating moves
              credits from it into a provider&apos;s budget. Credits are
              operational, not currency.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={onFund}>
            Fund system credits
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {budget === null && error === null ? (
          <p className="py-2 text-sm text-muted-foreground">
            Loading system budget…
          </p>
        ) : null}
        {error !== null ? (
          <p className="text-sm text-destructive" role="alert">
            {error}{" "}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={retryLoad}
            >
              Try again
            </button>
          </p>
        ) : null}
        {budget !== null ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <BudgetChip
              label="Unallocated credits"
              value={formatInt(budget.unallocated_credits)}
            />
            <BudgetChip
              label="Available for allocation"
              value={formatInt(budget.available_for_allocation_credits)}
            />
            <BudgetChip
              label="Allocated credits"
              value={formatInt(budget.allocated_credits)}
            />
            <BudgetChip
              label="Consumed credits"
              value={formatInt(budget.consumed_credits)}
            />
            <BudgetChip
              label="Lifetime funded"
              value={formatInt(budget.lifetime_funded_credits)}
            />
            <BudgetChip
              label="Updated"
              value={
                new Date(budget.updated_at).toLocaleString() === "Invalid Date"
                  ? budget.updated_at
                  : new Date(budget.updated_at).toLocaleString()
              }
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function ProviderBudgetCard({
  providerId,
  reloadTick,
  onTopUp,
}: {
  providerId: string
  reloadTick: number
  onTopUp: () => void
}) {
  const [budget, setBudget] = React.useState<ProviderBudget | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false

    getProviderBudget(providerId)
      .then((result) => {
        if (cancelled) return
        setBudget(result)
        setError(null)
      })
      .catch((requestError: unknown) => {
        if (cancelled) return
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load the provider budget."
        )
      })

    return () => {
      cancelled = true
    }
  }, [providerId, reloadTick, attempt])

  function retryLoad() {
    setBudget(null)
    setAttempt((current) => current + 1)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-1.5">
            <CardTitle className="text-base">Budget</CardTitle>
            <CardDescription>
              Credits allocated to this provider, consumed by its settled calls.
              Allocation draws from the system&apos;s unallocated balance.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={onTopUp}>
            Top up budget
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {budget === null && error === null ? (
          <p className="py-2 text-sm text-muted-foreground">Loading budget…</p>
        ) : null}
        {error !== null ? (
          <p className="text-sm text-destructive" role="alert">
            {error}{" "}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={retryLoad}
            >
              Try again
            </button>
          </p>
        ) : null}
        {budget !== null ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <BudgetChip
              label="Available credits"
              value={formatInt(budget.available_credits)}
            />
            <BudgetChip
              label="Reserved credits"
              value={formatInt(budget.reserved_credits)}
            />
            <BudgetChip
              label="Consumed credits"
              value={formatInt(budget.consumed_credits)}
            />
            <BudgetChip
              label="Lifetime allocated"
              value={formatInt(budget.lifetime_allocated_credits)}
            />
            <BudgetChip
              label="Updated"
              value={
                new Date(budget.updated_at).toLocaleString() === "Invalid Date"
                  ? budget.updated_at
                  : new Date(budget.updated_at).toLocaleString()
              }
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
