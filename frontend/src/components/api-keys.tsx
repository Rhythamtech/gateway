import * as React from "react"
import {
  IconBan,
  IconCircleCheckFilled,
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
  type ApiKeyItem,
} from "@/lib/auth"
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
import { Label } from "@/components/ui/label"
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
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
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
  const [copied, setCopied] = React.useState(false)

  const isSuperuser = user.role === "superuser"

  React.useEffect(() => {
    let cancelled = false

    listApiKeys()
      .then((result) => {
        if (cancelled) return
        setKeys(result.items)
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

  function refreshKeys() {
    setReloadTick((tick) => tick + 1)
  }

  function closeDrawer() {
    setDrawerState(null)
    setDrawerError(null)
    setPendingAction(false)
    setNewKeyName("")
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
      const created = await createApiKey(name)
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
                        colSpan={6}
                        className="h-24 text-center text-muted-foreground"
                      >
                        Loading API keys…
                      </TableCell>
                    </TableRow>
                  ) : keys.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No API keys yet. Create one to call the inference
                        endpoints.
                      </TableCell>
                    </TableRow>
                  ) : (
                    keys.map((key) => (
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
                            {key.revoked ? (
                              <IconBan />
                            ) : (
                              <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
                            )}
                            {key.revoked ? "Revoked" : "Active"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDateTime(key.created_at)}
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
                    ))
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
                <div className="flex flex-col gap-3">
                  <Label htmlFor="api-key-name">Name</Label>
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
                </div>
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
                  Copy the secret for “{drawerState.keyName}” now. It is shown
                  once and cannot be retrieved again.
                </DrawerDescription>
              </DrawerHeader>
              <div className="flex flex-col gap-4 px-4 text-sm">
                <code className="rounded-md bg-muted px-3 py-2 font-mono text-xs break-all select-all">
                  {drawerState.secret}
                </code>
              </div>
              <DrawerFooter>
                <Button type="button" onClick={handleCopy}>
                  {copied ? "Copied" : "Copy secret"}
                </Button>
                <DrawerClose asChild>
                  <Button type="button" variant="outline">
                    Done — I saved it
                  </Button>
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
