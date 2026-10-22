import * as React from "react"
import {
  IconBan,
  IconCircleCheckFilled,
  IconDotsVertical,
} from "@tabler/icons-react"
import { useIsMobile } from "@/hooks/use-mobile"

import {
  ApiError,
  listUsers,
  updateUserActive,
  type CurrentUser,
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

type DrawerState = { mode: "deactivate"; user: CurrentUser } | null

export function UsersContent({ user: signedInUser }: { user: CurrentUser }) {
  const [users, setUsers] = React.useState<CurrentUser[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [reloadTick, setReloadTick] = React.useState(0)
  const [drawerState, setDrawerState] = React.useState<DrawerState>(null)
  const [pendingUserId, setPendingUserId] = React.useState<string | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)

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

  const initialLoadFailed = loadError !== null && users === null

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
              Sign-in access for registered accounts. Deactivating a user also
              cuts off their API keys immediately.
            </p>
          </div>
          <div className="px-4 lg:px-6">
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
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users === null ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="h-24 text-center text-muted-foreground"
                      >
                        Loading users…
                      </TableCell>
                    </TableRow>
                  ) : users.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No users found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    users.map((user) => {
                      const isSelf = user.id === signedInUser.id
                      const isSuperuser = user.role === "superuser"

                      return (
                        <TableRow key={user.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {user.email}
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
                          <TableCell className="text-right">
                            {isSuperuser ? (
                              <span
                                className="text-xs text-muted-foreground"
                                title="Superusers cannot be deactivated"
                              >
                                No actions
                              </span>
                            ) : (
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
                                <DropdownMenuContent
                                  align="end"
                                  className="w-40"
                                >
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
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
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
            The user can no longer sign in, and their API keys immediately stop
            resolving inference requests. Their account and data are kept, and
            they can be re-enabled at any time.
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
