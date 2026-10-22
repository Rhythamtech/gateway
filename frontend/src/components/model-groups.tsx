import * as React from "react"
import {
  IconBan,
  IconCircleCheckFilled,
  IconDotsVertical,
  IconPlus,
} from "@tabler/icons-react"

import {
  ApiError,
  listModelGroups,
  updateModelGroup,
  type ModelGroup,
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
  ModelGroupActionDrawer,
  ModelGroupFormDrawer,
} from "@/components/model-group-drawers"

type DrawerState =
  | { mode: "form"; group: ModelGroup | null }
  | { mode: "disable"; group: ModelGroup }
  | null

function detailHref(groupId: string) {
  return `/dashboard/model-groups/detail?id=${encodeURIComponent(groupId)}`
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Never"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

// Groups are listed for superusers; the page is superuser-gated before this
// content renders, so no extra role checks happen here.
export function ModelGroupsContent() {
  const [groups, setGroups] = React.useState<ModelGroup[] | null>(null)
  const [total, setTotal] = React.useState<number | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [reloadTick, setReloadTick] = React.useState(0)
  const [drawerState, setDrawerState] = React.useState<DrawerState>(null)
  const [pendingGroupId, setPendingGroupId] = React.useState<string | null>(
    null
  )
  const [actionError, setActionError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false

    // One page of 100 covers the management view; more entries surface a hint.
    listModelGroups({ pageSize: 100 })
      .then((result) => {
        if (cancelled) return
        setGroups(result.items)
        setTotal(result.total)
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadError(
          error instanceof Error
            ? error.message
            : "Unable to load model groups."
        )
      })

    return () => {
      cancelled = true
    }
  }, [reloadTick])

  function refreshGroups() {
    setReloadTick((tick) => tick + 1)
  }

  async function handleEnable(group: ModelGroup) {
    setPendingGroupId(group.id)
    setActionError(null)

    try {
      await updateModelGroup(group.id, { is_enabled: true })
      toast.success(`Model group “${group.name}” enabled.`)
      refreshGroups()
    } catch (error) {
      setActionError(
        error instanceof ApiError
          ? error.message
          : "Unable to enable the model group."
      )
    } finally {
      setPendingGroupId(null)
    }
  }

  const initialLoadFailed = loadError !== null && groups === null

  return (
    <>
      {initialLoadFailed ? (
        <div className="px-4 lg:px-6">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Unable to load model groups</CardTitle>
              <CardDescription>{loadError}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={refreshGroups}>Try again</Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          <div className="flex flex-col items-start justify-between gap-2 px-4 lg:flex-row lg:items-center lg:px-6">
            <p className="text-sm text-muted-foreground">
              Groups of provider models served under one public model ID.
              Routing is failover by member priority.
            </p>
            <Button
              size="sm"
              onClick={() => {
                setActionError(null)
                setDrawerState({ mode: "form", group: null })
              }}
            >
              <IconPlus />
              <span className="hidden lg:inline">Create model group</span>
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
                  onClick={refreshGroups}
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
            {total !== null && total > (groups?.length ?? 0) ? (
              <p className="mb-2 text-xs text-muted-foreground">
                Showing the first {groups?.length ?? 0} of {total} groups.
              </p>
            ) : null}
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted">
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Model ID</TableHead>
                    <TableHead>Strategy</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Members</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups === null ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="h-24 text-center text-muted-foreground"
                      >
                        Loading model groups…
                      </TableCell>
                    </TableRow>
                  ) : groups.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No model groups yet. Create one to route across
                        providers.
                      </TableCell>
                    </TableRow>
                  ) : (
                    groups.map((group) => (
                      <TableRow key={group.id}>
                        <TableCell className="font-medium">
                          <a
                            className="underline-offset-2 hover:underline"
                            href={detailHref(group.id)}
                          >
                            {group.name}
                          </a>
                        </TableCell>
                        <TableCell>
                          <code className="font-mono text-xs text-muted-foreground">
                            {group.model_id}
                          </code>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="px-1.5 text-muted-foreground"
                          >
                            {group.routing_strategy === "round_robin"
                              ? "Round robin"
                              : "Weighted round robin"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="px-1.5 text-muted-foreground"
                          >
                            {group.is_enabled ? (
                              <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
                            ) : (
                              <IconBan />
                            )}
                            {group.is_enabled ? "Enabled" : "Disabled"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {group.member_count}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDateTime(group.updated_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground data-[state=open]:bg-muted"
                                disabled={pendingGroupId === group.id}
                              >
                                <IconDotsVertical />
                                <span className="sr-only">
                                  Actions for {group.name}
                                </span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              <DropdownMenuItem asChild>
                                <a href={detailHref(group.id)}>View details</a>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  setActionError(null)
                                  setDrawerState({ mode: "form", group })
                                }}
                              >
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {group.is_enabled ? (
                                <DropdownMenuItem
                                  onSelect={() => {
                                    setActionError(null)
                                    setDrawerState({
                                      mode: "disable",
                                      group,
                                    })
                                  }}
                                >
                                  Disable
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onSelect={() => handleEnable(group)}
                                >
                                  Enable
                                </DropdownMenuItem>
                              )}
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
        <ModelGroupFormDrawer
          key={drawerState.group?.id ?? "create"}
          open={true}
          group={drawerState.group}
          onClose={() => setDrawerState(null)}
          onSaved={(group) => {
            const wasCreate = drawerState.group === null
            setDrawerState(null)
            refreshGroups()
            toast.success(
              wasCreate
                ? `Model group “${group.name}” created.`
                : `Model group “${group.name}” updated.`
            )
          }}
        />
      ) : null}
      {drawerState?.mode === "disable" ? (
        <ModelGroupActionDrawer
          key={drawerState.group.id}
          group={drawerState.group}
          onClose={() => setDrawerState(null)}
          onDone={() => {
            const name = drawerState.group.name
            setDrawerState(null)
            refreshGroups()
            toast.success(`Model group “${name}” disabled.`)
          }}
        />
      ) : null}
    </>
  )
}
