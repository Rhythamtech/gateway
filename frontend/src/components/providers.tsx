import * as React from "react"
import {
  IconBan,
  IconCircleCheckFilled,
  IconDotsVertical,
  IconPlus,
} from "@tabler/icons-react"

import {
  ApiError,
  listProviders,
  updateProvider,
  type Provider,
} from "@/lib/auth"
import { formatTimestampInDeviceZone, parseApiTimestamp } from "@/lib/datetime"
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

type DrawerState =
  | { mode: "form"; provider: Provider | null }
  | { mode: "disable"; provider: Provider }
  | { mode: "delete"; provider: Provider }
  | null

function detailHref(providerId: string) {
  return `/dashboard/providers/detail?id=${encodeURIComponent(providerId)}`
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Never"
  const date = parseApiTimestamp(value)
  return date === null ? value : formatTimestampInDeviceZone(date)
}

export function ProvidersContent() {
  const [providers, setProviders] = React.useState<Provider[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [reloadTick, setReloadTick] = React.useState(0)
  const latestReload = React.useRef(0)
  const [drawerState, setDrawerState] = React.useState<DrawerState>(null)
  const [pendingProviderId, setPendingProviderId] = React.useState<
    string | null
  >(null)
  const [actionError, setActionError] = React.useState<string | null>(null)

  React.useEffect(() => {
    const controller = new AbortController()
    const isCurrent = () =>
      !controller.signal.aborted && reloadTick === latestReload.current

    listProviders(controller.signal)
      .then((result) => {
        if (!isCurrent()) return
        setProviders(result)
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (!isCurrent()) return
        setLoadError(
          error instanceof Error ? error.message : "Unable to load providers."
        )
      })

    return () => controller.abort()
  }, [reloadTick])

  function refreshProviders() {
    latestReload.current += 1
    setReloadTick(latestReload.current)
  }

  function applySavedProvider(saved: Provider) {
    setProviders(
      (current) =>
        current
          ?.map((provider) => (provider.id === saved.id ? saved : provider))
          .sort((left, right) => left.name.localeCompare(right.name)) ?? null
    )
    refreshProviders()
  }

  async function handleEnable(provider: Provider) {
    setPendingProviderId(provider.id)
    setActionError(null)

    try {
      const saved = await updateProvider(provider.id, { is_enabled: true })
      toast.success(`Provider “${provider.name}” enabled.`)
      applySavedProvider(saved)
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
              Saved credentials stay hidden.
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
            if (wasCreate) {
              window.location.assign(
                `${detailHref(provider.id)}&setup=1&sync=1`
              )
            } else {
              applySavedProvider(provider)
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
    </>
  )
}
