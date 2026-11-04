import * as React from "react"
import { IconPlayerPlay } from "@tabler/icons-react"

import {
  getMyCredits,
  listMyCreditHistory,
  listMyCreditUsage,
  type CreditBalance,
  type CreditEntry,
  type CreditUsage,
} from "@/lib/auth"
import { isZeroCredits } from "@/lib/credits"
import { UsageDetailDrawer } from "@/components/credit-drawers"
import {
  BalanceCard,
  CreditPaginationBar,
  HistoryRecords,
  UsageRecords,
} from "@/components/credit-tracking"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const PAGE_SIZE = 20

function TabSkeletonRows() {
  return (
    <div className="flex flex-col gap-3.5 py-2">
      <Skeleton className="h-4 w-56" />
      <Skeleton className="h-4 w-44" />
      <Skeleton className="h-4 w-52" />
    </div>
  )
}

export function CreditsContent() {
  const [balance, setBalance] = React.useState<CreditBalance | null>(null)
  const [balanceError, setBalanceError] = React.useState<string | null>(null)
  const [balanceTick, setBalanceTick] = React.useState(0)

  const [activeTab, setActiveTab] = React.useState("usage")

  const [usagePage, setUsagePage] = React.useState(1)
  const [usageData, setUsageData] = React.useState<{
    items: CreditUsage[]
    total: number
  } | null>(null)
  const [usageError, setUsageError] = React.useState<string | null>(null)
  const [usageTick, setUsageTick] = React.useState(0)

  const [historyPage, setHistoryPage] = React.useState(1)
  const [historyData, setHistoryData] = React.useState<{
    items: CreditEntry[]
    total: number
  } | null>(null)
  const [historyError, setHistoryError] = React.useState<string | null>(null)
  const [historyTick, setHistoryTick] = React.useState(0)

  const [selectedUsage, setSelectedUsage] = React.useState<CreditUsage | null>(
    null
  )

  React.useEffect(() => {
    let cancelled = false
    getMyCredits()
      .then((result) => {
        if (cancelled) return
        setBalance(result)
        setBalanceError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setBalanceError(
          error instanceof Error
            ? error.message
            : "Unable to load your credits."
        )
      })
    return () => {
      cancelled = true
    }
  }, [balanceTick])

  React.useEffect(() => {
    if (activeTab !== "usage") return
    let cancelled = false
    listMyCreditUsage({ page: usagePage, pageSize: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return
        setUsageData({ items: result.items, total: result.total })
        setUsageError(null)
        const lastPage = Math.max(1, Math.ceil(result.total / result.page_size))
        if (result.items.length === 0 && usagePage > lastPage)
          setUsagePage(lastPage)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setUsageError(
          error instanceof Error ? error.message : "Unable to load your usage."
        )
      })
    return () => {
      cancelled = true
    }
  }, [activeTab, usagePage, usageTick])

  React.useEffect(() => {
    if (activeTab !== "history") return
    let cancelled = false
    listMyCreditHistory({ page: historyPage, pageSize: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return
        setHistoryData({ items: result.items, total: result.total })
        setHistoryError(null)
        const lastPage = Math.max(1, Math.ceil(result.total / result.page_size))
        if (result.items.length === 0 && historyPage > lastPage)
          setHistoryPage(lastPage)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setHistoryError(
          error instanceof Error
            ? error.message
            : "Unable to load your history."
        )
      })
    return () => {
      cancelled = true
    }
  }, [activeTab, historyPage, historyTick])

  function retryBalance() {
    setBalanceError(null)
    setBalanceTick((tick) => tick + 1)
  }

  return (
    <div className="@container/credits flex flex-col gap-6 lg:gap-8">
      <p className="max-w-[60ch] text-sm text-muted-foreground">
        Credits fund inference on this gateway. Charges follow each
        request&apos;s recorded usage, and every movement appears in your
        history.
      </p>

      {balanceError ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-2">
            <p className="text-sm text-destructive">{balanceError}</p>
            <Button variant="outline" size="sm" onClick={retryBalance}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <BalanceCard
          state={balance ? { phase: "ready", balance } : { phase: "loading" }}
          onRetry={retryBalance}
        />
      )}

      <div className="grid min-w-0 gap-6 @min-[960px]/credits:grid-cols-12">
        <div className="min-w-0 @min-[960px]/credits:col-span-8">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="usage">Model usage</TabsTrigger>
              <TabsTrigger value="history">Credit history</TabsTrigger>
            </TabsList>
            <TabsContent value="usage" className="mt-4">
              {usageError ? (
                <div className="flex flex-col items-start gap-2 py-2">
                  <p className="text-sm text-destructive">{usageError}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setUsageTick((tick) => tick + 1)}
                  >
                    Try again
                  </Button>
                </div>
              ) : usageData === null ? (
                <TabSkeletonRows />
              ) : usageData.items.length === 0 ? (
                <div className="flex flex-col items-start gap-1.5 py-4">
                  <p className="text-sm font-medium">No usage recorded yet.</p>
                  <p className="text-sm text-muted-foreground">
                    Run a request in the Playground to see charges land here.
                  </p>
                  <Button asChild variant="outline" size="sm" className="mt-1">
                    <a href="/dashboard/playground">
                      <IconPlayerPlay data-slot="icon" />
                      Open Playground
                    </a>
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <UsageRecords
                    items={usageData.items}
                    onOpenDetails={setSelectedUsage}
                  />
                  <CreditPaginationBar
                    page={usagePage}
                    pageSize={PAGE_SIZE}
                    total={usageData.total}
                    onPage={setUsagePage}
                  />
                </div>
              )}
            </TabsContent>
            <TabsContent value="history" className="mt-4">
              {historyError ? (
                <div className="flex flex-col items-start gap-2 py-2">
                  <p className="text-sm text-destructive">{historyError}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setHistoryTick((tick) => tick + 1)}
                  >
                    Try again
                  </Button>
                </div>
              ) : historyData === null ? (
                <TabSkeletonRows />
              ) : historyData.items.length === 0 ? (
                <div className="flex flex-col items-start gap-1.5 py-4">
                  <p className="text-sm font-medium">No credit history yet.</p>
                  <p className="text-sm text-muted-foreground">
                    Credit additions and request charges appear here as they are
                    recorded.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <HistoryRecords items={historyData.items} />
                  <CreditPaginationBar
                    page={historyPage}
                    pageSize={PAGE_SIZE}
                    total={historyData.total}
                    onPage={setHistoryPage}
                  />
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <div className="flex min-w-0 flex-col gap-6 @min-[960px]/credits:col-span-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">How charging works</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
              <p>
                Credits are spent as{" "}
                <span className="font-medium text-foreground">
                  input + output tokens ÷ tokens per credit
                </span>
                . One rate applies to both deductions.
              </p>
              <p>
                A rate such as 10 tokens per credit is a conversion rate — it is
                not inherently a discount.
              </p>
              <p>
                Credits are operational units on this gateway, not currency.
                There are no payments, invoices, or automatic top-ups.
              </p>
            </CardContent>
          </Card>
          {balance !== null && isZeroCredits(balance.available_credits) ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Need credits?</CardTitle>
                <CardDescription>
                  An administrator adds credits from the Users page. Requests
                  are rejected until your balance is funded, and unfinished
                  requests hold credits while they run.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : null}
        </div>
      </div>

      {selectedUsage ? (
        <UsageDetailDrawer
          usage={selectedUsage}
          onClose={() => setSelectedUsage(null)}
        />
      ) : null}
    </div>
  )
}
