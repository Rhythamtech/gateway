import * as React from "react"
import {
  IconBan,
  IconCircleCheckFilled,
  IconDotsVertical,
  IconPlus,
} from "@tabler/icons-react"

import {
  ApiError,
  getModelGroup,
  updateModelGroup,
  type ModelGroup,
  type ModelGroupMember,
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
  ModelGroupMemberActionDrawer,
  ModelGroupMemberFormDrawer,
} from "@/components/model-group-drawers"

type DrawerState =
  | { mode: "form"; group: ModelGroup }
  | { mode: "disable"; group: ModelGroup }
  | { mode: "member-form"; member: ModelGroupMember | null }
  | { mode: "member-remove"; member: ModelGroupMember }
  | null

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Never"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function ModelGroupDetailContent() {
  const [groupId] = React.useState(() =>
    new URLSearchParams(window.location.search).get("id")
  )
  const [group, setGroup] = React.useState<ModelGroup | null>(null)
  const [groupError, setGroupError] = React.useState<string | null>(null)
  const [groupTick, setGroupTick] = React.useState(0)
  const [drawerState, setDrawerState] = React.useState<DrawerState>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!groupId) return
    let cancelled = false

    getModelGroup(groupId)
      .then((result) => {
        if (cancelled) return
        setGroup(result)
        setGroupError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setGroupError(
          error instanceof Error ? error.message : "Unable to load model group."
        )
      })

    return () => {
      cancelled = true
    }
  }, [groupId, groupTick])

  function refreshGroup() {
    setGroupTick((tick) => tick + 1)
  }

  async function handleEnable() {
    if (!group) return
    setActionError(null)

    try {
      await updateModelGroup(group.id, { is_enabled: true })
      toast.success(`Model group “${group.name}” enabled.`)
      refreshGroup()
    } catch (error) {
      setActionError(
        error instanceof ApiError
          ? error.message
          : "Unable to enable the model group."
      )
    }
  }

  if (!groupId) {
    return (
      <div className="px-4 lg:px-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>No model group selected</CardTitle>
            <CardDescription>
              Open a model group from the list to see its details.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <a href="/dashboard/model-groups">Back to model groups</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (groupError !== null && group === null) {
    return (
      <div className="flex flex-col gap-4 px-4 lg:px-6">
        <a
          className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          href="/dashboard/model-groups"
        >
          Back to model groups
        </a>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Unable to load model group</CardTitle>
            <CardDescription>{groupError}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={refreshGroup}>Try again</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (group === null) {
    return (
      <div className="px-4 lg:px-6">
        <p className="text-sm text-muted-foreground">Loading model group…</p>
      </div>
    )
  }

  const hasEligibleMember = group.members.some((member) => member.is_available)

  return (
    <>
      <div className="flex flex-col gap-4 px-4 lg:px-6">
        <a
          className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          href="/dashboard/model-groups"
        >
          Back to model groups
        </a>
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex flex-col gap-2">
                <CardTitle className="text-lg">{group.name}</CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className="px-1.5 text-muted-foreground"
                  >
                    {group.routing_strategy === "round_robin"
                      ? "Round robin"
                      : "Weighted round robin"}
                  </Badge>
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
                  {group.is_enabled && !hasEligibleMember ? (
                    <Badge
                      variant="outline"
                      className="border-amber-500 px-1.5 text-amber-700 dark:text-amber-400"
                    >
                      No available members
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
                    setDrawerState({ mode: "form", group })
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
                      <span className="sr-only">Actions for {group.name}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    {group.is_enabled ? (
                      <DropdownMenuItem
                        onSelect={() => {
                          setActionError(null)
                          setDrawerState({ mode: "disable", group })
                        }}
                      >
                        Disable
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={handleEnable}>
                        Enable
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Public model ID</p>
              <code className="font-mono text-sm">{group.model_id}</code>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Members</p>
              <p className="text-sm">{group.member_count}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Created</p>
              <p className="text-sm">{formatDateTime(group.created_at)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Updated</p>
              <p className="text-sm">{formatDateTime(group.updated_at)}</p>
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
            Members are tried in ascending priority order — lower numbers first.
            Weights spread traffic in weighted round-robin mode.
          </p>
          {group.is_enabled && !hasEligibleMember ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              The group is enabled but no member is currently available on an
              enabled provider.
            </p>
          ) : null}
        </div>
        <Button
          size="sm"
          onClick={() => {
            setActionError(null)
            setDrawerState({ mode: "member-form", member: null })
          }}
        >
          <IconPlus />
          <span className="hidden lg:inline">Add member</span>
          <span className="lg:hidden">Add</span>
        </Button>
      </div>
      <div className="px-4 lg:px-6">
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted">
              <TableRow>
                <TableHead>Priority</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Weight</TableHead>
                <TableHead>Availability</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.members.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No members yet. Add a synced provider model to route across.
                  </TableCell>
                </TableRow>
              ) : (
                group.members.map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <span className="font-mono text-xs">
                        {member.priority}
                      </span>
                    </TableCell>
                    <TableCell>
                      <code className="font-mono text-xs">
                        {member.provider_model_id_public}
                      </code>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {member.provider_name}{" "}
                      <span className="text-xs">({member.provider_alias})</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {member.weight}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="px-1.5 text-muted-foreground"
                      >
                        {member.is_available ? (
                          <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
                        ) : (
                          <IconBan />
                        )}
                        {member.is_available ? "Available" : "Unavailable"}
                      </Badge>
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
                              Actions for {member.provider_model_id_public}
                            </span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem
                            onSelect={() => {
                              setActionError(null)
                              setDrawerState({
                                mode: "member-form",
                                member,
                              })
                            }}
                          >
                            Edit member
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => {
                              setActionError(null)
                              setDrawerState({
                                mode: "member-remove",
                                member,
                              })
                            }}
                          >
                            Remove
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

      {drawerState?.mode === "form" ? (
        <ModelGroupFormDrawer
          key={drawerState.group.id}
          open={true}
          group={drawerState.group}
          onClose={() => setDrawerState(null)}
          onSaved={(group) => {
            setDrawerState(null)
            refreshGroup()
            toast.success(`Model group “${group.name}” updated.`)
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
            refreshGroup()
            toast.success(`Model group “${name}” disabled.`)
          }}
        />
      ) : null}
      {drawerState?.mode === "member-form" ? (
        <ModelGroupMemberFormDrawer
          key={drawerState.member?.id ?? "add-member"}
          open={true}
          groupId={group.id}
          member={drawerState.member}
          onClose={() => setDrawerState(null)}
          onSaved={() => {
            const wasAdd = drawerState.member === null
            setDrawerState(null)
            refreshGroup()
            toast.success(wasAdd ? "Member added." : "Member updated.")
          }}
        />
      ) : null}
      {drawerState?.mode === "member-remove" ? (
        <ModelGroupMemberActionDrawer
          key={drawerState.member.id}
          groupId={group.id}
          member={drawerState.member}
          onClose={() => setDrawerState(null)}
          onDone={() => {
            const modelId = drawerState.member.provider_model_id_public
            setDrawerState(null)
            refreshGroup()
            toast.success(`Member ${modelId} removed.`)
          }}
        />
      ) : null}
    </>
  )
}
