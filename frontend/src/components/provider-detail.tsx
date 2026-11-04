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
  listProviderModels,
  syncProviderModels,
  updateProvider,
  type Provider,
  type ProviderModel,
  type ProviderSyncResult,
} from "@/lib/auth"
import { formatTimestampInDeviceZone, parseApiTimestamp } from "@/lib/datetime"
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
  | { mode: "form"; provider: Provider }
  | { mode: "disable"; provider: Provider }
  | { mode: "delete"; provider: Provider }
  | null

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

  function refreshProvider() {
    setProviderTick((tick) => tick + 1)
  }

  function refreshModels() {
    setModelsTick((tick) => tick + 1)
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {models === null ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-24 text-center text-muted-foreground"
                  >
                    Loading models…
                  </TableCell>
                </TableRow>
              ) : models.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
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
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
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
