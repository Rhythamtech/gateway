import * as React from "react"
import {
  IconBan,
  IconCircleCheckFilled,
  IconDotsVertical,
  IconPlus,
} from "@tabler/icons-react"

import {
  ApiError,
  createSystemBudgetTopUp,
  listProviders,
  syncProviderModels,
  updateProvider,
  type Provider,
} from "@/lib/auth"
import { toast } from "sonner"
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
import { SystemBudgetCard, TopUpFormDrawer } from "@/components/budget"

type DrawerState =
  | { mode: "form"; provider: Provider | null }
  | { mode: "disable"; provider: Provider }
  | { mode: "delete"; provider: Provider }
  | { mode: "fund" }
  | null

function detailHref(providerId: string) {
  return `/dashboard/providers/detail?id=${encodeURIComponent(providerId)}`
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Never"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function ProvidersContent() {
  const [providers, setProviders] = React.useState<Provider[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [reloadTick, setReloadTick] = React.useState(0)
  const [drawerState, setDrawerState] = React.useState<DrawerState>(null)
  const [pendingProviderId, setPendingProviderId] = React.useState<
    string | null
  >(null)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [budgetTick, setBudgetTick] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false

    listProviders()
      .then((result) => {
        if (cancelled) return
        setProviders(result)
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadError(
          error instanceof Error ? error.message : "Unable to load providers."
        )
      })

    return () => {
      cancelled = true
    }
  }, [reloadTick])

  function refreshProviders() {
    setReloadTick((tick) => tick + 1)
  }

  async function handleEnable(provider: Provider) {
    setPendingProviderId(provider.id)
    setActionError(null)

    try {
      await updateProvider(provider.id, { is_enabled: true })
      toast.success(`Provider “${provider.name}” enabled.`)
      refreshProviders()
    } catch (error) {
      setActionError(
        error instanceof ApiError
          ? error.message
          : "Unable to enable the provider."
      )
    } finally {
      setPendingProviderId(null)
    }
  }

  // Auto-sync runs right after creation so the new provider's models are
  // imported without a manual step; the Sync button stays available for
  // refreshes afterwards. Progress is reported as side toast notifications.
  async function handleCreated(provider: Provider) {
    const toastId = toast.loading(
      `Provider “${provider.name}” created — syncing models…`
    )

    try {
      const result = await syncProviderModels(provider.id)
      toast.success(
        result.synced === 0
          ? `“${provider.name}”: no models were found to sync.`
          : `“${provider.name}”: ${result.synced} models synced.`,
        { id: toastId }
      )
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? `“${provider.name}” was created, but the model sync failed: ${error.message}`
          : `“${provider.name}” was created, but the model sync failed.`,
        { id: toastId, duration: 8000 }
      )
    }
  }

  const initialLoadFailed = loadError !== null && providers === null

  return (
    <>
      {initialLoadFailed ? (
        <div className="px-4 lg:px-6">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Unable to load providers</CardTitle>
              <CardDescription>{loadError}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={refreshProviders}>Try again</Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          <div className="flex flex-col items-start justify-between gap-2 px-4 lg:flex-row lg:items-center lg:px-6">
            <p className="text-sm text-muted-foreground">
              Providers registered for the gateway. Stored credentials are never
              returned.
            </p>
            <Button
              size="sm"
              onClick={() => {
                setActionError(null)
                setDrawerState({ mode: "form", provider: null })
              }}
            >
              <IconPlus />
              <span className="hidden lg:inline">Create provider</span>
              <span className="lg:hidden">Create</span>
            </Button>
          </div>
          <div className="px-4 lg:px-6">
            <SystemBudgetCard
              reloadTick={budgetTick}
              onFund={() => {
                setActionError(null)
                setDrawerState({ mode: "fund" })
              }}
            />
          </div>
          <div className="px-4 lg:px-6">
            {loadError !== null ? (
              <p className="mb-2 text-sm text-destructive" role="alert">
                {loadError}{" "}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={refreshProviders}
                >
                  Try again
                </button>
              </p>
            ) : null}
            {actionError !== null ? (
              <p className="mb-2 text-sm text-destructive" role="alert">
                {actionError}
              </p>
            ) : null}
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted">
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Alias</TableHead>
                    <TableHead>Protocol</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Credentials</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {providers === null ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="h-24 text-center text-muted-foreground"
                      >
                        Loading providers…
                      </TableCell>
                    </TableRow>
                  ) : providers.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No providers yet. Create one to route inference through
                        the gateway.
                      </TableCell>
                    </TableRow>
                  ) : (
                    providers.map((provider) => (
                      <TableRow key={provider.id}>
                        <TableCell className="font-medium">
                          <a
                            className="underline-offset-2 hover:underline"
                            href={detailHref(provider.id)}
                          >
                            {provider.name}
                          </a>
                        </TableCell>
                        <TableCell>
                          <code className="font-mono text-xs text-muted-foreground">
                            {provider.aliases}
                          </code>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="px-1.5 text-muted-foreground"
                          >
                            {provider.protocol}
                          </Badge>
                        </TableCell>
                        <TableCell>
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
                        </TableCell>
                        <TableCell>
                          {provider.has_api_key ||
                          provider.has_custom_header ? (
                            <div className="flex gap-1">
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
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDateTime(provider.updated_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground data-[state=open]:bg-muted"
                                disabled={pendingProviderId === provider.id}
                              >
                                <IconDotsVertical />
                                <span className="sr-only">
                                  Actions for {provider.name}
                                </span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              <DropdownMenuItem asChild>
                                <a href={detailHref(provider.id)}>
                                  View details
                                </a>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  setActionError(null)
                                  setDrawerState({
                                    mode: "form",
                                    provider,
                                  })
                                }}
                              >
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {provider.is_enabled ? (
                                <DropdownMenuItem
                                  onSelect={() => {
                                    setActionError(null)
                                    setDrawerState({
                                      mode: "disable",
                                      provider,
                                    })
                                  }}
                                >
                                  Disable
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onSelect={() => handleEnable(provider)}
                                >
                                  Enable
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => {
                                  setActionError(null)
                                  setDrawerState({
                                    mode: "delete",
                                    provider,
                                  })
                                }}
                              >
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}

      {drawerState?.mode === "form" ? (
        <ProviderFormDrawer
          key={drawerState.provider?.id ?? "create"}
          open={true}
          provider={drawerState.provider}
          onClose={() => setDrawerState(null)}
          onSaved={(provider) => {
            const wasCreate = drawerState.provider === null
            setDrawerState(null)
            refreshProviders()
            if (wasCreate) {
              void handleCreated(provider)
            } else {
              toast.success(`Provider “${provider.name}” updated.`)
            }
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
            const name = drawerState.provider.name
            setDrawerState(null)
            refreshProviders()
            toast.success(`Provider “${name}” disabled.`)
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
            const name = drawerState.provider.name
            setDrawerState(null)
            refreshProviders()
            toast.success(`Provider “${name}” deleted.`)
          }}
        />
      ) : null}
      {drawerState?.mode === "fund" ? (
        <TopUpFormDrawer
          title="Fund system credits"
          description="Funding records new credits in the system's unallocated balance. Provider budgets are topped up separately from each provider's detail page."
          submitLabel="Fund system credits"
          pendingLabel="Funding…"
          onSubmit={async (input) => {
            const created = await createSystemBudgetTopUp(input)
            setBudgetTick((tick) => tick + 1)

            return {
              headline: `${created.amount_credits.toLocaleString("en-US")} credits funded.`,
              lines: [
                {
                  label: "Transaction ID",
                  value: created.transaction_id,
                  mono: true,
                },
                {
                  label: "Unallocated after",
                  value: created.unallocated_credits.toLocaleString("en-US"),
                },
                {
                  label: "Allocated after",
                  value: created.allocated_credits.toLocaleString("en-US"),
                },
                {
                  label: "Consumed after",
                  value: created.consumed_credits.toLocaleString("en-US"),
                },
                {
                  label: "Reason",
                  value: created.reason,
                  mono: true,
                },
                {
                  label: "Recorded at",
                  value: formatDateTime(created.created_at),
                },
              ],
            }
          }}
          onSubmitted={() => toast.success("System credits funded.")}
          onClose={() => setDrawerState(null)}
        />
      ) : null}
    </>
  )
}
