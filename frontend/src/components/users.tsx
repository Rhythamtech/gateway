import * as React from "react"
import {
  IconBan,
  IconCircleCheckFilled,
  IconDotsVertical,
  IconSearch,
} from "@tabler/icons-react"
import { useIsMobile } from "@/hooks/use-mobile"

import {
  ApiError,
  listUsers,
  updateUserActive,
  updateUserTracing,
  type CurrentUser,
} from "@/lib/auth"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "cn"
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
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { UsageAnalyticsDrawer } from "@/components/usage-drawers"
import { CreditFundingDrawer } from "@/components/credit-drawers"
import { UserCreditsDrawer } from "@/components/credit-tracking"

type DrawerState =
  | { mode: "deactivate"; user: CurrentUser }
  | { mode: "usage"; user: CurrentUser }
  | { mode: "credits"; user: CurrentUser; nonce: number }
  | { mode: "fund"; user: CurrentUser; nonce: number }
  | null

export function UsersContent({ user: signedInUser }: { user: CurrentUser }) {
  const [users, setUsers] = React.useState<CurrentUser[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [reloadTick, setReloadTick] = React.useState(0)
  const [drawerState, setDrawerState] = React.useState<DrawerState>(null)
  const [pendingUserId, setPendingUserId] = React.useState<string | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState("")
  const [roleFilter, setRoleFilter] = React.useState("all")
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [tracingFilter, setTracingFilter] = React.useState("all")

  React.useEffect(() => {
    let cancelled = false

    listUsers()
      .then((result) => {
        if (cancelled) return
        setUsers(result)
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadError(
          error instanceof Error ? error.message : "Unable to load users."
        )
      })

    return () => {
      cancelled = true
    }
  }, [reloadTick])

  function refreshUsers() {
    setReloadTick((tick) => tick + 1)
  }

  async function handleEnable(target: CurrentUser) {
    setPendingUserId(target.id)
    setActionError(null)

    try {
      await updateUserActive(target.id, true)
      toast.success(`“${target.email}” can sign in again.`)
      refreshUsers()
    } catch (error) {
      setActionError(
        error instanceof ApiError ? error.message : "Unable to enable the user."
      )
    } finally {
      setPendingUserId(null)
    }
  }

  async function handleToggleTracing(target: CurrentUser) {
    setPendingUserId(target.id)
    setActionError(null)

    const nextState = !target.tracing_enabled
    try {
      await updateUserTracing(target.id, nextState)
      toast.success(
        nextState
          ? `Tracing enabled for “${target.email}”. Requests will be recorded in Request traces.`
          : `Tracing disabled for “${target.email}”.`
      )
      refreshUsers()
    } catch (error) {
      setActionError(
        error instanceof ApiError ? error.message : "Unable to update tracing."
      )
    } finally {
      setPendingUserId(null)
    }
  }

  const initialLoadFailed = loadError !== null && users === null
  const visibleUsers = (users ?? []).filter(
    (item) =>
      item.email.toLowerCase().includes(query.trim().toLowerCase()) &&
      (roleFilter === "all" || item.role === roleFilter) &&
      (statusFilter === "all" || String(item.is_active) === statusFilter) &&
      (tracingFilter === "all" ||
        String(item.tracing_enabled) === tracingFilter)
  )

  return (
    <>
      {initialLoadFailed ? (
        <div className="px-4 lg:px-6">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Unable to load users</CardTitle>
              <CardDescription>{loadError}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={refreshUsers}>Try again</Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          <div className="flex flex-col items-start justify-between gap-2 px-4 lg:flex-row lg:items-center lg:px-6">
            <p className="text-sm text-muted-foreground">
              User accounts and access management.
            </p>
          </div>
          <div className="flex flex-col gap-3 px-4 lg:px-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground" role="status">
                {visibleUsers.length} of {users?.length ?? 0} accounts
              </p>
              {(query ||
                roleFilter !== "all" ||
                statusFilter !== "all" ||
                tracingFilter !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setQuery("")
                    setRoleFilter("all")
                    setStatusFilter("all")
                    setTracingFilter("all")
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
            <div className="users-filter-toolbar">
              <InputGroup>
                <InputGroupInput
                  type="search"
                  aria-label="Search users by email"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search email"
                />
                <InputGroupAddon>
                  <IconSearch aria-hidden="true" />
                </InputGroupAddon>
              </InputGroup>
              {[
                {
                  label: "Role",
                  value: roleFilter,
                  set: setRoleFilter,
                  options: [
                    ["all", "All roles"],
                    ["user", "User"],
                    ["superuser", "Superuser"],
                  ],
                },
                {
                  label: "Status",
                  value: statusFilter,
                  set: setStatusFilter,
                  options: [
                    ["all", "All statuses"],
                    ["true", "Active"],
                    ["false", "Inactive"],
                  ],
                },
                {
                  label: "Tracing",
                  value: tracingFilter,
                  set: setTracingFilter,
                  options: [
                    ["all", "All tracing"],
                    ["true", "Enabled"],
                    ["false", "Disabled"],
                  ],
                },
              ].map((filter) => (
                <Select
                  key={filter.label}
                  value={filter.value}
                  onValueChange={filter.set}
                >
                  <SelectTrigger
                    aria-label={`Filter by ${filter.label.toLowerCase()}`}
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {filter.options.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ))}
            </div>
            {loadError !== null ? (
              <p className="mb-2 text-sm text-destructive" role="alert">
                {loadError}{" "}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={refreshUsers}
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
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Tracing</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users === null ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="h-24 text-center text-muted-foreground"
                      >
                        Loading users…
                      </TableCell>
                    </TableRow>
                  ) : visibleUsers.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No users match these filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    visibleUsers.map((user) => {
                      const isSelf = user.id === signedInUser.id
                      const isSuperuser = user.role === "superuser"

                      return (
                        <TableRow key={user.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <a
                                className="underline-offset-4 hover:underline"
                                href={`/dashboard/users/detail?id=${encodeURIComponent(user.id)}`}
                              >
                                {user.email}
                              </a>
                              {isSelf ? (
                                <Badge
                                  variant="secondary"
                                  className="px-1.5 text-xs"
                                >
                                  You
                                </Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className="px-1.5 text-muted-foreground"
                            >
                              {isSuperuser ? "Superuser" : "User"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className="px-1.5 text-muted-foreground"
                            >
                              {user.is_active ? (
                                <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
                              ) : (
                                <IconBan />
                              )}
                              {user.is_active ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <button
                              type="button"
                              onClick={() => handleToggleTracing(user)}
                              disabled={pendingUserId === user.id}
                              className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium transition-colors hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                              title={
                                user.tracing_enabled
                                  ? "Tracing is enabled. Click to disable."
                                  : "Tracing is disabled. Click to enable."
                              }
                            >
                              <span
                                className={cn(
                                  "size-2 rounded-full",
                                  user.tracing_enabled
                                    ? "bg-green-500"
                                    : "bg-muted-foreground/40"
                                )}
                              />
                              <span
                                className={cn(
                                  user.tracing_enabled
                                    ? "text-foreground"
                                    : "text-muted-foreground"
                                )}
                              >
                                {user.tracing_enabled ? "Enabled" : "Disabled"}
                              </span>
                            </button>
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="text-muted-foreground data-[state=open]:bg-muted"
                                  disabled={pendingUserId === user.id}
                                >
                                  <IconDotsVertical />
                                  <span className="sr-only">
                                    Actions for {user.email}
                                  </span>
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem
                                  onSelect={() => {
                                    setDrawerState({
                                      mode: "usage",
                                      user,
                                    })
                                  }}
                                >
                                  View usage
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() => {
                                    setDrawerState({
                                      mode: "credits",
                                      user,
                                      nonce: 0,
                                    })
                                  }}
                                >
                                  View credits
                                </DropdownMenuItem>
                                <DropdownMenuItem asChild>
                                  <a
                                    href={`/dashboard/users/detail?id=${encodeURIComponent(user.id)}`}
                                  >
                                    View account
                                  </a>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() => {
                                    setActionError(null)
                                    setDrawerState({
                                      mode: "fund",
                                      user,
                                      nonce: 0,
                                    })
                                  }}
                                >
                                  Add credits
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  disabled={pendingUserId === user.id}
                                  onSelect={() => handleToggleTracing(user)}
                                >
                                  {user.tracing_enabled
                                    ? "Disable tracing"
                                    : "Enable tracing"}
                                </DropdownMenuItem>
                                {!isSuperuser ? (
                                  <>
                                    <DropdownMenuSeparator />
                                    {user.is_active ? (
                                      <DropdownMenuItem
                                        onSelect={() => {
                                          setActionError(null)
                                          setDrawerState({
                                            mode: "deactivate",
                                            user,
                                          })
                                        }}
                                      >
                                        Deactivate
                                      </DropdownMenuItem>
                                    ) : (
                                      <DropdownMenuItem
                                        onSelect={() => handleEnable(user)}
                                      >
                                        Enable
                                      </DropdownMenuItem>
                                    )}
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

      {drawerState?.mode === "deactivate" ? (
        <DeactivateUserDrawer
          key={drawerState.user.id}
          user={drawerState.user}
          onClose={() => setDrawerState(null)}
          onDone={() => {
            const email = drawerState.user.email
            setDrawerState(null)
            refreshUsers()
            toast.success(`“${email}” deactivated.`)
          }}
        />
      ) : null}
      {drawerState?.mode === "credits" ? (
        <UserCreditsDrawer
          key={`${drawerState.user.id}-${drawerState.nonce}`}
          user={{ id: drawerState.user.id, email: drawerState.user.email }}
          onClose={() => setDrawerState(null)}
          onAddCredits={() => {
            setActionError(null)
            setDrawerState((prev) =>
              prev?.mode === "credits"
                ? { mode: "fund", user: prev.user, nonce: prev.nonce }
                : prev
            )
          }}
        />
      ) : null}
      {drawerState?.mode === "fund" ? (
        <CreditFundingDrawer
          key={`${drawerState.user.id}-fund-${drawerState.nonce}`}
          target={{
            kind: "user",
            id: drawerState.user.id,
            name: drawerState.user.email,
          }}
          balance={null}
          onClose={() => setDrawerState(null)}
          onFunded={() => {
            setDrawerState((prev) =>
              prev?.mode === "fund"
                ? {
                    mode: "credits",
                    user: prev.user,
                    nonce: prev.nonce + 1,
                  }
                : prev
            )
          }}
        />
      ) : null}
      {drawerState?.mode === "usage" ? (
        <UsageAnalyticsDrawer
          key={drawerState.user.id}
          subject={{
            kind: "user",
            id: drawerState.user.id,
            label: drawerState.user.email,
          }}
          scopeNote="Totals aggregate all usage generated by this user."
          onClose={() => setDrawerState(null)}
        />
      ) : null}
    </>
  )
}

type DeactivateUserDrawerProps = {
  user: CurrentUser
  onClose: () => void
  onDone: () => void
}

function DeactivateUserDrawer({
  user,
  onClose,
  onDone,
}: DeactivateUserDrawerProps) {
  const isMobile = useIsMobile()
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  async function handleConfirm() {
    setPending(true)
    setError(null)

    try {
      await updateUserActive(user.id, false)
      onDone()
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : "Unable to deactivate the user."
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
        <DrawerHeader className="gap-1">
          <DrawerTitle>Deactivate “{user.email}”?</DrawerTitle>
          <DrawerDescription>
            Deactivating prevents sign-in and stops all associated API keys
            immediately. The account can be re-enabled at any time.
          </DrawerDescription>
        </DrawerHeader>
        {error ? (
          <p className="px-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DrawerFooter>
          <Button type="button" onClick={handleConfirm} disabled={pending}>
            {pending ? "Deactivating…" : "Deactivate user"}
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
