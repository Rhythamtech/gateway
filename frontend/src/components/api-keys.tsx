import * as React from "react"
import {
  IconBan,
  IconCircleCheckFilled,
  IconCopy,
  IconDotsVertical,
  IconPlus,
} from "@tabler/icons-react"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  ApiError,
  createApiKey,
  deleteApiKey,
  listApiKeys,
  revokeApiKey,
  type ApiKeyExpiry,
  type ApiKeyItem,
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
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type ApiKeysContentProps = {
  user: { role: "user" | "superuser" }
}

type DrawerState =
  | { mode: "create" }
  | { mode: "secret"; secret: string; keyName: string }
  | { mode: "revoke"; key: ApiKeyItem }
  | { mode: "delete"; key: ApiKeyItem }
  | null

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Never"
  const date = parseApiTimestamp(value)
  return date === null ? value : formatTimestampInDeviceZone(date)
}

export function ApiKeysContent({ user }: ApiKeysContentProps) {
  const isMobile = useIsMobile()
  const [keys, setKeys] = React.useState<ApiKeyItem[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [reloadTick, setReloadTick] = React.useState(0)
  const [drawerState, setDrawerState] = React.useState<DrawerState>(null)
  const [drawerError, setDrawerError] = React.useState<string | null>(null)
  const [pendingAction, setPendingAction] = React.useState(false)
  const [newKeyName, setNewKeyName] = React.useState("")
  const [newKeyExpiry, setNewKeyExpiry] = React.useState<ApiKeyExpiry>("never")
  const [now, setNow] = React.useState(Date.now)
  const [copied, setCopied] = React.useState(false)

  const isSuperuser = user.role === "superuser"

  React.useEffect(() => {
    let cancelled = false

    listApiKeys()
      .then((result) => {
        if (cancelled) return
        setKeys(result.items)
        setNow(Date.now())
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadError(
          error instanceof Error ? error.message : "Unable to load API keys."
        )
      })

    return () => {
      cancelled = true
    }
  }, [reloadTick])

  React.useEffect(() => {
    const nextExpiry = Math.min(
      ...(keys ?? [])
        .filter((key) => !key.revoked && key.expires_at)
        .map((key) => parseApiTimestamp(key.expires_at!)?.getTime() ?? 0)
        .filter((expiry) => expiry > now)
    )
    if (!Number.isFinite(nextExpiry)) return
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(nextExpiry - Date.now(), 0), 2_147_483_647)
    )
    return () => window.clearTimeout(timer)
  }, [keys, now])

  function refreshKeys() {
    setReloadTick((tick) => tick + 1)
  }

  function closeDrawer() {
    setDrawerState(null)
    setDrawerError(null)
    setPendingAction(false)
    setNewKeyName("")
    setNewKeyExpiry("never")
    setCopied(false)
  }

  async function handleCreate(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newKeyName.trim()
    if (!name) {
      setDrawerError("Enter a name for the new key.")
      return
    }

    setPendingAction(true)
    setDrawerError(null)

    try {
      const created = await createApiKey(name, newKeyExpiry)
      setDrawerState({
        mode: "secret",
        secret: created.api_key,
        keyName: created.name,
      })
      setCopied(false)
      refreshKeys()
    } catch (error) {
      setDrawerError(
        error instanceof ApiError
          ? error.message
          : "Unable to create the API key."
      )
    } finally {
      setPendingAction(false)
    }
  }

  async function handleRevoke() {
    if (!drawerState || drawerState.mode !== "revoke") return
    setPendingAction(true)
    setDrawerError(null)

    try {
      await revokeApiKey(drawerState.key.id)
      closeDrawer()
      refreshKeys()
    } catch (error) {
      setDrawerError(
        error instanceof ApiError
          ? error.message
          : "Unable to revoke the API key."
      )
    } finally {
      setPendingAction(false)
    }
  }

  async function handleDelete() {
    if (!drawerState || drawerState.mode !== "delete") return
    setPendingAction(true)
    setDrawerError(null)

    try {
      await deleteApiKey(drawerState.key.id)
      closeDrawer()
      refreshKeys()
    } catch (error) {
      setDrawerError(
        error instanceof ApiError
          ? error.message
          : "Unable to delete the API key."
      )
    } finally {
      setPendingAction(false)
    }
  }

  async function handleCopy() {
    if (!drawerState || drawerState.mode !== "secret") return
    setCopied(false)

    try {
      await navigator.clipboard.writeText(drawerState.secret)
      setCopied(true)
    } catch {
      // Clipboard unavailable; the user can still select the secret manually.
    }
  }

  const initialLoadFailed = loadError !== null && keys === null

  return (
    <>
      {initialLoadFailed ? (
        <div className="px-4 lg:px-6">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Unable to load API keys</CardTitle>
              <CardDescription>{loadError}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={refreshKeys}>Try again</Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          <div className="flex flex-col items-start justify-between gap-2 px-4 lg:flex-row lg:items-center lg:px-6">
            <p className="text-sm text-muted-foreground">
              Keys authenticate your API clients on the inference endpoints.
            </p>
            <Button
              size="sm"
              onClick={() => {
                setDrawerError(null)
                setNewKeyName("")
                setNewKeyExpiry("never")
                setDrawerState({ mode: "create" })
              }}
            >
              <IconPlus />
              <span className="hidden lg:inline">Create API key</span>
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
                  onClick={refreshKeys}
                >
                  Try again
                </button>
              </p>
            ) : null}
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted">
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys === null ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="h-24 text-center text-muted-foreground"
                      >
                        Loading API keys…
                      </TableCell>
                    </TableRow>
                  ) : keys.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No API keys yet. Create one to call the inference
                        endpoints.
                      </TableCell>
                    </TableRow>
                  ) : (
                    keys.map((key) => {
                      const expired = key.expires_at
                        ? (parseApiTimestamp(key.expires_at)?.getTime() ??
                            Infinity) <= now
                        : false
                      const inactive = key.revoked || expired
                      return (
                        <TableRow key={key.id}>
                          <TableCell className="font-medium">
                            {key.name}
                          </TableCell>
                          <TableCell>
                            <code className="font-mono text-xs text-muted-foreground">
                              {key.key_prefix}…
                            </code>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className="px-1.5 text-muted-foreground"
                            >
                              {inactive ? (
                                <IconBan />
                              ) : (
                                <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
                              )}
                              {key.revoked
                                ? "Revoked"
                                : expired
                                  ? "Expired"
                                  : "Active"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDateTime(key.created_at)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDateTime(key.expires_at)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDateTime(key.last_used_at)}
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="text-muted-foreground data-[state=open]:bg-muted"
                                >
                                  <IconDotsVertical />
                                  <span className="sr-only">
                                    Actions for {key.name}
                                  </span>
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-40">
                                {!key.revoked ? (
                                  <DropdownMenuItem
                                    onSelect={() => {
                                      setDrawerError(null)
                                      setDrawerState({
                                        mode: "revoke",
                                        key,
                                      })
                                    }}
                                  >
                                    Revoke
                                  </DropdownMenuItem>
                                ) : null}
                                {isSuperuser ? (
                                  <>
                                    {!key.revoked ? (
                                      <DropdownMenuSeparator />
                                    ) : null}
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onSelect={() => {
                                        setDrawerError(null)
                                        setDrawerState({
                                          mode: "delete",
                                          key,
                                        })
                                      }}
                                    >
                                      Delete
                                    </DropdownMenuItem>
                                  </>
                                ) : null}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}

      <Drawer
        direction={isMobile ? "bottom" : "right"}
        open={drawerState !== null}
        onOpenChange={(open) => {
          if (!open) closeDrawer()
        }}
      >
        <DrawerContent>
          {drawerState?.mode === "create" ? (
            <>
              <DrawerHeader className="gap-1">
                <DrawerTitle>Create API key</DrawerTitle>
                <DrawerDescription>
                  Give the key a name so you can recognize it later. The secret
                  is shown once, right after creation.
                </DrawerDescription>
              </DrawerHeader>
              <form
                id="create-api-key-form"
                className="flex flex-col gap-4 px-4 text-sm"
                onSubmit={handleCreate}
              >
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="api-key-name">Name</FieldLabel>
                    <Input
                      id="api-key-name"
                      name="name"
                      value={newKeyName}
                      onChange={(event) => setNewKeyName(event.target.value)}
                      placeholder="e.g. Production server"
                      minLength={1}
                      maxLength={120}
                      required
                      autoFocus
                    />
                  </Field>
                  <Field>
                    <FieldLabel id="api-key-expiry-label">
                      Expires after
                    </FieldLabel>
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      size="sm"
                      value={newKeyExpiry}
                      onValueChange={(value) =>
                        setNewKeyExpiry((value || "never") as ApiKeyExpiry)
                      }
                      aria-labelledby="api-key-expiry-label"
                      aria-describedby="api-key-expiry-help"
                      disabled={pendingAction}
                    >
                      <ToggleGroupItem value="1h">1 hour</ToggleGroupItem>
                      <ToggleGroupItem value="24h">24 hours</ToggleGroupItem>
                      <ToggleGroupItem value="1week">1 week</ToggleGroupItem>
                      <ToggleGroupItem value="never">Never</ToggleGroupItem>
                    </ToggleGroup>
                    <FieldDescription id="api-key-expiry-help">
                      Starts when the key is created. Leave unset for no expiry.
                    </FieldDescription>
                  </Field>
                </FieldGroup>
                {drawerError ? (
                  <p className="text-sm text-destructive" role="alert">
                    {drawerError}
                  </p>
                ) : null}
              </form>
              <DrawerFooter>
                <Button
                  type="submit"
                  form="create-api-key-form"
                  disabled={pendingAction}
                >
                  {pendingAction ? "Creating…" : "Create key"}
                </Button>
                <DrawerClose asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </DrawerClose>
              </DrawerFooter>
            </>
          ) : null}

          {drawerState?.mode === "secret" ? (
            <>
              <DrawerHeader className="gap-1">
                <DrawerTitle>API key created</DrawerTitle>
                <DrawerDescription>
                  The secret for “{drawerState.keyName}” is shown only once.
                </DrawerDescription>
              </DrawerHeader>
              <div className="flex flex-col gap-3 px-4 text-sm">
                <div className="flex items-center gap-2 rounded-lg border bg-muted p-2 pl-3">
                  <code
                    tabIndex={0}
                    className="min-w-0 flex-1 overflow-x-auto font-mono text-xs leading-6 whitespace-nowrap select-all focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {drawerState.secret}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant={copied ? "secondary" : "outline"}
                    className="shrink-0"
                    onClick={handleCopy}
                  >
                    {copied ? (
                      <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
                    ) : (
                      <IconCopy />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  It cannot be retrieved again once this drawer is closed — save
                  it in a secure place now.
                </p>
              </div>
              <DrawerFooter>
                <DrawerClose asChild>
                  <Button type="button">Done — I saved it</Button>
                </DrawerClose>
              </DrawerFooter>
            </>
          ) : null}

          {drawerState?.mode === "revoke" ? (
            <>
              <DrawerHeader className="gap-1">
                <DrawerTitle>Revoke “{drawerState.key.name}”?</DrawerTitle>
                <DrawerDescription>
                  Requests using this key are rejected with 401 immediately.
                  Revoking cannot be undone.
                </DrawerDescription>
              </DrawerHeader>
              {drawerError ? (
                <p className="px-4 text-sm text-destructive" role="alert">
                  {drawerError}
                </p>
              ) : null}
              <DrawerFooter>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleRevoke}
                  disabled={pendingAction}
                >
                  {pendingAction ? "Revoking…" : "Revoke key"}
                </Button>
                <DrawerClose asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </DrawerClose>
              </DrawerFooter>
            </>
          ) : null}

          {drawerState?.mode === "delete" ? (
            <>
              <DrawerHeader className="gap-1">
                <DrawerTitle>
                  Delete “{drawerState.key.name}” permanently?
                </DrawerTitle>
                <DrawerDescription>
                  Deleting removes the key and prevents it from authenticating
                  any API client. This cannot be undone.
                </DrawerDescription>
              </DrawerHeader>
              {drawerError ? (
                <p className="px-4 text-sm text-destructive" role="alert">
                  {drawerError}
                </p>
              ) : null}
              <DrawerFooter>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={pendingAction}
                >
                  {pendingAction ? "Deleting…" : "Delete key"}
                </Button>
                <DrawerClose asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </DrawerClose>
              </DrawerFooter>
            </>
          ) : null}
        </DrawerContent>
      </Drawer>
    </>
  )
}
