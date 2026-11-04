import * as React from "react"

import { getMyCredits, listMyCreditUsage } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { BalanceCard, UsageRecordsCard } from "@/components/credit-tracking"

type BalanceState =
  | { phase: "loading" }
  | { phase: "error"; error: string }
  | { phase: "ready"; balance: Awaited<ReturnType<typeof getMyCredits>> }

type UsageState =
  | { phase: "loading" }
  | { phase: "error"; error: string }
  | {
      phase: "ready"
      items: Awaited<ReturnType<typeof listMyCreditUsage>>["items"]
    }

export function DashboardOverview() {
  const [balance, setBalance] = React.useState<BalanceState>({
    phase: "loading",
  })
  const [usage, setUsage] = React.useState<UsageState>({ phase: "loading" })
  const [balanceTick, setBalanceTick] = React.useState(0)
  const [usageTick, setUsageTick] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    getMyCredits()
      .then((result) => {
        if (cancelled) return
        setBalance({ phase: "ready", balance: result })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setBalance({
          phase: "error",
          error:
            error instanceof Error
              ? error.message
              : "Unable to load your credits.",
        })
      })
    return () => {
      cancelled = true
    }
  }, [balanceTick])

  React.useEffect(() => {
    let cancelled = false
    listMyCreditUsage({ page: 1, pageSize: 5 })
      .then((result) => {
        if (cancelled) return
        setUsage({ phase: "ready", items: result.items })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setUsage({
          phase: "error",
          error:
            error instanceof Error
              ? error.message
              : "Unable to load your requests.",
        })
      })
    return () => {
      cancelled = true
    }
  }, [usageTick])

  function retryBalance() {
    setBalance({ phase: "loading" })
    setBalanceTick((tick) => tick + 1)
  }

  function retryUsage() {
    setUsage({ phase: "loading" })
    setUsageTick((tick) => tick + 1)
  }

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <div className="flex flex-col items-start gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
        <p className="max-w-[52ch] text-sm text-muted-foreground">
          Your credits and latest requests on this gateway.
        </p>
        <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
          <Button asChild className="w-full sm:w-auto">
            <a href="/dashboard/playground">Open Playground</a>
          </Button>
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <a href="/dashboard/api-keys">API Keys</a>
          </Button>
        </div>
      </div>
      <BalanceCard
        state={balance}
        onRetry={retryBalance}
        viewAllHref="/dashboard/credits"
      />
      <UsageRecordsCard state={usage} onRetry={retryUsage} />
    </div>
  )
}
