import * as React from "react"
import {
  IconBan,
  IconCircleCheckFilled,
  IconDotsVertical,
  IconRefresh,
} from "@tabler/icons-react"

import {
  ApiError,
  getProvider,
  getProviderCredits,
  listProviderCreditHistory,
  listProviderModels,
  syncProviderModels,
  updateProvider,
  type CreditBalance,
  type CreditEntry,
  type ModelCreditRate,
  type Provider,
  type ProviderModel,
  type ProviderSyncResult,
} from "@/lib/auth"
import { formatCredits, isZeroCredits } from "@/lib/credits"
import { formatTimestampInDeviceZone, parseApiTimestamp } from "@/lib/datetime"
import {
  CreditFundingDrawer,
  ModelRateDrawer,
} from "@/components/credit-drawers"
import {
  CreditPaginationBar,
  HistoryRecords,
} from "@/components/credit-tracking"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ProviderActionDrawer,
  ProviderFormDrawer,
} from "@/components/provider-drawers"

type DrawerState =
  | { mode: "form"; provider: Provider }
  | { mode: "disable"; provider: Provider }
  | { mode: "delete"; provider: Provider }
  | { mode: "fund"; provider: Provider }
  | { mode: "rate"; provider: Provider; model: ProviderModel }
  | null

type ModelRateState =
  { status: "missing" } | { status: "loaded"; rate: ModelCreditRate }

const CREDIT_HISTORY_PAGE_SIZE = 20

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Never"
  const date = parseApiTimestamp(value)
  return date === null ? value : formatTimestampInDeviceZone(date)
}

export function ProviderDetailContent() {
  const [providerId] = React.useState(() =>
    new URLSearchParams(window.location.search).get("id")
  )
  const [provider, setProvider] = React.useState<Provider | null>(null)
  const [providerError, setProviderError] = React.useState<string | null>(null)
  const [providerTick, setProviderTick] = React.useState(0)
  const [models, setModels] = React.useState<ProviderModel[] | null>(null)
  const [modelsError, setModelsError] = React.useState<string | null>(null)
  const [modelsTick, setModelsTick] = React.useState(0)
  const [syncPending, setSyncPending] = React.useState(false)
  const [syncResult, setSyncResult] = React.useState<ProviderSyncResult | null>(
    null
  )
  const [syncError, setSyncError] = React.useState<string | null>(null)
  const [drawerState, setDrawerState] = React.useState<DrawerState>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [balance, setBalance] = React.useState<CreditBalance | null>(null)
  const [balanceError, setBalanceError] = React.useState<string | null>(null)
  const [balanceTick, setBalanceTick] = React.useState(0)
  const [rateStates, setRateStates] = React.useState<
    Record<string, ModelRateState>
  >({})
  const [historyPage, setHistoryPage] = React.useState(1)
  const [historyData, setHistoryData] = React.useState<{
    items: CreditEntry[]
    total: number
  } | null>(null)
  const [historyError, setHistoryError] = React.useState<string | null>(null)
  const [historyTick, setHistoryTick] = React.useState(0)

  React.useEffect(() => {
    if (!providerId) return
    let cancelled = false

    getProvider(providerId)
      .then((result) => {
        if (cancelled) return
        setProvider(result)
        setProviderError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setProviderError(
          error instanceof Error ? error.message : "Unable to load provider."
        )
      })

    return () => {
      cancelled = true
    }
  }, [providerId, providerTick])

  React.useEffect(() => {
    if (!providerId) return
    let cancelled = false

    listProviderModels(providerId)
      .then((result) => {
        if (cancelled) return
        setModels(result)
        setModelsError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setModelsError(
          error instanceof Error
            ? error.message
            : "Unable to load provider models."
        )
      })

    return () => {
      cancelled = true
    }
  }, [providerId, modelsTick])

  React.useEffect(() => {
    if (!providerId) return
    let cancelled = false

    getProviderCredits(providerId)
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
            : "Unable to load provider credits."
        )
      })

    return () => {
      cancelled = true
    }
  }, [providerId, balanceTick])

  React.useEffect(() => {
    if (!providerId) return
    let cancelled = false

    listProviderCreditHistory(providerId, {
      page: historyPage,
      pageSize: CREDIT_HISTORY_PAGE_SIZE,
    })
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
            : "Unable to load credit history."
        )
      })

    return () => {
      cancelled = true
    }
  }, [providerId, historyPage, historyTick])

  function refreshProvider() {
    setProviderTick((tick) => tick + 1)
  }

  function refreshModels() {
    setModelsTick((tick) => tick + 1)
  }

  function rateLabel(modelId: string): string {
    const state = rateStates[modelId]
    if (!state) return "Credit rate"
    return state.status === "missing" ? "Configure rate" : "Edit rate"
  }

  async function handleSync() {
    if (!providerId || !provider) return
    setSyncPending(true)
    setSyncError(null)

    try {
      const result = await syncProviderModels(providerId)
      setSyncResult(result)
      refreshModels()
    } catch (error) {
      setSyncError(
        error instanceof ApiError
          ? error.message
          : "Unable to sync provider models."
      )
    } finally {
      setSyncPending(false)
    }
  }

  async function handleEnable() {
    if (!provider) return
    setActionError(null)

    try {
      await updateProvider(provider.id, { is_enabled: true })
      refreshProvider()
    } catch (error) {
      setActionError(
        error instanceof ApiError
          ? error.message
          : "Unable to enable the provider."
      )
    }
  }

  if (!providerId) {
    return (
      <div className="px-4 lg:px-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>No provider selected</CardTitle>
            <CardDescription>
              Open a provider from the list to see its details.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <a href="/dashboard/providers">Back to providers</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (providerError !== null && provider === null) {
    return (
      <div className="flex flex-col gap-4 px-4 lg:px-6">
        <a
          className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          href="/dashboard/providers"
        >
          Back to providers
        </a>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Unable to load provider</CardTitle>
            <CardDescription>{providerError}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={refreshProvider}>Try again</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (provider === null) {
    return (
      <div className="px-4 lg:px-6">
        <p className="text-sm text-muted-foreground">Loading provider…</p>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-4 px-4 lg:px-6">
        <a
          className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          href="/dashboard/providers"
        >
          Back to providers
        </a>
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex flex-col gap-2">
                <CardTitle className="text-lg">{provider.name}</CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className="px-1.5 text-muted-foreground"
                  >
                    {provider.protocol}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="px-1.5 text-muted-foreground"
                  >
                    {provider.is_enabled ? (
                      <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
                    ) : (
                      <IconBan />
                    )}
                    {provider.is_enabled ? "Enabled" : "Disabled"}
                  </Badge>
                  {provider.has_api_key ? (
                    <Badge variant="secondary" className="px-1.5">
                      API key
                    </Badge>
                  ) : null}
                  {provider.has_custom_header ? (
                    <Badge variant="secondary" className="px-1.5">
                      Custom header
                    </Badge>
                  ) : null}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setActionError(null)
                    setDrawerState({ mode: "form", provider })
                  }}
                >
                  Edit
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground data-[state=open]:bg-muted"
                    >
                      <IconDotsVertical />
                      <span className="sr-only">
                        Actions for {provider.name}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    {provider.is_enabled ? (
                      <DropdownMenuItem
                        onSelect={() => {
                          setActionError(null)
                          setDrawerState({ mode: "disable", provider })
                        }}
                      >
                        Disable
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={handleEnable}>
                        Enable
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => {
                        setActionError(null)
                        setDrawerState({ mode: "delete", provider })
                      }}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Alias</p>
              <code className="font-mono text-sm">{provider.aliases}</code>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Base URL</p>
              <p className="text-sm break-all">{provider.base_url}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Created</p>
              <p className="text-sm">{formatDateTime(provider.created_at)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Updated</p>
              <p className="text-sm">{formatDateTime(provider.updated_at)}</p>
            </div>
          </CardContent>
        </Card>
        {balanceError !== null ? (
          <Card>
            <CardContent className="flex flex-col items-start gap-2">
              <p className="text-sm text-destructive">{balanceError}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBalanceTick((tick) => tick + 1)}
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <CardTitle className="text-base">Credits</CardTitle>
                  <CardDescription>
                    Provider credits fund inference routed to this provider.
                    They are not synchronized from the upstream account.
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    setActionError(null)
                    setDrawerState({ mode: "fund", provider })
                  }}
                >
                  Add credits
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5">
              {balance ? (
                <>
                  <CardDescription>Available credits</CardDescription>
                  <CardTitle className="text-[32px] leading-10 font-semibold tabular-nums md:text-[40px] md:leading-12">
                    {formatCredits(balance.available_credits)}
                  </CardTitle>
                  <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
                    <span className="flex items-baseline gap-2">
                      <span className="text-muted-foreground">In use</span>
                      <span className="font-medium tabular-nums">
                        {formatCredits(balance.reserved_credits)}
                      </span>
                    </span>
                    <Separator
                      orientation="vertical"
                      className="hidden h-4 self-center sm:block"
                    />
                    <span className="flex items-baseline gap-2">
                      <span className="text-muted-foreground">Remaining</span>
                      <span className="font-medium tabular-nums">
                        {formatCredits(balance.remaining_credits)}
                      </span>
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    In use = credits temporarily held by unfinished requests.
                    Available = remaining minus in use. A request reserves its
                    full maximum allowance before dispatch, so a hold can exceed
                    the final charge; the difference is released when the
                    request settles.
                  </p>
                  {isZeroCredits(balance.available_credits) ? (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Requests are rejected while this provider has no available
                      credits. Add credits to fund inference.
                    </p>
                  ) : null}
                </>
              ) : (
                <Skeleton className="h-10 w-48" />
              )}
            </CardContent>
          </Card>
        )}
        {actionError !== null ? (
          <p className="text-sm text-destructive" role="alert">
            {actionError}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col items-start justify-between gap-2 px-4 lg:flex-row lg:items-center lg:px-6">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            Synced from the provider&apos;s model endpoint. Public model IDs use
            the alias prefix.
          </p>
          {syncResult ? (
            <p className="text-xs text-muted-foreground">
              Last sync: {syncResult.synced} upstream · {syncResult.created}{" "}
              added · {syncResult.updated} updated · {syncResult.unavailable}{" "}
              now unavailable.
            </p>
          ) : null}
          {modelsError !== null ? (
            <p className="text-sm text-destructive" role="alert">
              {modelsError}{" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={refreshModels}
              >
                Try again
              </button>
            </p>
          ) : null}
          {syncError !== null ? (
            <p className="text-sm text-destructive" role="alert">
              {syncError}
            </p>
          ) : null}
          {provider && !provider.is_enabled ? (
            <p className="text-xs text-muted-foreground">
              Enable the provider to sync models.
            </p>
          ) : null}
        </div>
        <Button
          size="sm"
          onClick={handleSync}
          disabled={syncPending || !provider.is_enabled}
        >
          <IconRefresh />
          <span className="hidden lg:inline">Sync models</span>
          <span className="lg:hidden">Sync</span>
        </Button>
      </div>
      <div className="px-4 lg:px-6">
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted">
              <TableRow>
                <TableHead>Public model ID</TableHead>
                <TableHead>Upstream name</TableHead>
                <TableHead>Availability</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Credit rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models === null ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-24 text-center text-muted-foreground"
                  >
                    Loading models…
                  </TableCell>
                </TableRow>
              ) : models.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No synced models. Run a sync to import them from the
                    provider.
                  </TableCell>
                </TableRow>
              ) : (
                models.map((model) => (
                  <TableRow key={model.id}>
                    <TableCell>
                      <code className="font-mono text-xs">
                        {model.model_id}
                      </code>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground">
                        {model.model_name}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="px-1.5 text-muted-foreground"
                      >
                        {model.is_available ? (
                          <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
                        ) : (
                          <IconBan />
                        )}
                        {model.is_available ? "Available" : "Unavailable"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(model.last_seen_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(model.updated_at)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setActionError(null)
                          setDrawerState({ mode: "rate", provider, model })
                        }}
                      >
                        {rateLabel(model.id)}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="px-4 lg:px-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Credit history</CardTitle>
            <CardDescription>
              Additions and charges recorded against this provider&apos;s
              balance, newest first.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0">
            {historyError !== null ? (
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
              <div className="flex flex-col gap-3.5 py-2">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-4 w-52" />
              </div>
            ) : historyData.items.length === 0 ? (
              <div className="flex flex-col items-start gap-1.5 py-4">
                <p className="text-sm font-medium">No credit history yet.</p>
                <p className="text-sm text-muted-foreground">
                  Credit additions and request charges appear here as they are
                  recorded.
                </p>
              </div>
            ) : (
              <div className="@container/credits flex flex-col gap-4">
                <HistoryRecords items={historyData.items} />
                <CreditPaginationBar
                  page={historyPage}
                  pageSize={CREDIT_HISTORY_PAGE_SIZE}
                  total={historyData.total}
                  onPage={setHistoryPage}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {drawerState?.mode === "form" ? (
        <ProviderFormDrawer
          key={drawerState.provider.id}
          open={true}
          provider={drawerState.provider}
          onClose={() => setDrawerState(null)}
          onSaved={() => {
            setDrawerState(null)
            refreshProvider()
            refreshModels()
          }}
        />
      ) : null}
      {drawerState?.mode === "disable" ? (
        <ProviderActionDrawer
          key={drawerState.provider.id}
          action="disable"
          provider={drawerState.provider}
          onClose={() => setDrawerState(null)}
          onDone={() => {
            setDrawerState(null)
            refreshProvider()
          }}
        />
      ) : null}
      {drawerState?.mode === "fund" ? (
        <CreditFundingDrawer
          key={`fund-${drawerState.provider.id}`}
          target={{
            kind: "provider",
            id: drawerState.provider.id,
            name: drawerState.provider.name,
          }}
          balance={balance}
          onClose={() => setDrawerState(null)}
          onFunded={() => {
            setDrawerState(null)
            setBalanceTick((tick) => tick + 1)
            setHistoryPage(1)
            setHistoryTick((tick) => tick + 1)
          }}
        />
      ) : null}
      {drawerState?.mode === "rate" ? (
        <ModelRateDrawer
          key={drawerState.model.id}
          model={drawerState.model}
          onClose={() => setDrawerState(null)}
          onSaved={(rate) => {
            setDrawerState(null)
            setRateStates((prev) => ({
              ...prev,
              [rate.provider_model_id]: { status: "loaded", rate },
            }))
          }}
        />
      ) : null}
      {drawerState?.mode === "delete" ? (
        <ProviderActionDrawer
          key={drawerState.provider.id}
          action="delete"
          provider={drawerState.provider}
          onClose={() => setDrawerState(null)}
          onDone={() => {
            setDrawerState(null)
            window.location.assign("/dashboard/providers")
          }}
        />
      ) : null}
    </>
  )
}
