import * as React from "react"
import {
  IconArrowRight,
  IconBan,
  IconCircleCheckFilled,
  IconDotsVertical,
  IconPlus,
  IconRefresh,
  IconRoute,
  IconScale,
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

function StrategyBadge({ strategy }: { strategy: string }) {
  if (strategy === "priority") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-sky-500/40 px-1.5 text-sky-600 dark:text-sky-400"
      >
        <IconRoute className="size-3" />
        Priority (Failover)
      </Badge>
    )
  }
  if (strategy === "weighted_round_robin") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-amber-500/40 px-1.5 text-amber-600 dark:text-amber-400"
      >
        <IconScale className="size-3" />
        Weighted
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1 px-1.5 text-muted-foreground">
      <IconRefresh className="size-3" />
      Round robin
    </Badge>
  )
}

function RoutingPipelineVisualizer({ group }: { group: ModelGroup }) {
  const members = group.members ?? []

  if (members.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center gap-1.5 py-6 text-center text-xs text-muted-foreground">
          <IconRoute className="size-5 text-muted-foreground/60" />
          <span className="font-medium text-foreground">
            No routing pipeline configured
          </span>
          <p>
            Add provider model members to construct the routing and failover
            chain.
          </p>
        </CardContent>
      </Card>
    )
  }

  if (group.routing_strategy === "priority") {
    // Priority order: priority ASC, weight DESC
    const sorted = [...members].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority
      return b.weight - a.weight
    })

    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-semibold">
                Sequential Failover Pipeline
              </CardTitle>
              <Badge
                variant="outline"
                className="border-sky-500/40 font-mono text-xs text-sky-600 dark:text-sky-400"
              >
                <IconRoute className="mr-1 size-3" />
                Priority Routing
              </Badge>
            </div>
            <span className="text-xs text-muted-foreground">
              {sorted.length}{" "}
              {sorted.length === 1
                ? "candidate route"
                : "sequential route steps"}
            </span>
          </div>
          <CardDescription className="text-xs">
            Requests always target the Primary candidate first. If a candidate
            becomes unavailable or disabled, traffic fails over sequentially to
            the next priority step without client errors.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 overflow-x-auto pt-1 pb-2">
            <div className="flex min-w-max items-center gap-2">
              {sorted.map((member, idx) => {
                const isPrimary = idx === 0
                return (
                  <React.Fragment key={member.id}>
                    <div
                      className={`flex max-w-[260px] min-w-[200px] flex-col gap-2 rounded-lg border p-3 text-xs shadow-xs transition-all ${
                        member.is_available
                          ? isPrimary
                            ? "border-sky-500/60 bg-sky-500/5 dark:bg-sky-950/20"
                            : "border-border bg-card"
                          : "border-border/60 bg-muted/40 opacity-70"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <Badge
                          variant="outline"
                          className={
                            isPrimary
                              ? "border-sky-500/50 bg-sky-500/10 font-medium text-sky-600 dark:text-sky-400"
                              : "text-muted-foreground"
                          }
                        >
                          {isPrimary
                            ? "1. Primary Route"
                            : `${idx + 1}. Fallback #${idx}`}
                        </Badge>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          P:{member.priority} W:{member.weight}
                        </span>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <code
                          className="truncate font-mono text-xs font-semibold text-foreground"
                          title={member.provider_model_id_public}
                        >
                          {member.provider_model_id_public}
                        </code>
                        <span className="truncate text-[11px] text-muted-foreground">
                          {member.provider_name} ({member.provider_alias})
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 pt-1 text-[11px]">
                        {member.is_available ? (
                          <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                            <IconCircleCheckFilled className="size-3" />
                            Eligible & Active
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                            <IconBan className="size-3" />
                            Provider Unavailable
                          </span>
                        )}
                      </div>
                    </div>

                    {idx < sorted.length - 1 ? (
                      <div className="flex flex-col items-center gap-1 px-1">
                        <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                          failover
                        </span>
                        <IconArrowRight className="size-4 text-muted-foreground" />
                      </div>
                    ) : null}
                  </React.Fragment>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (group.routing_strategy === "weighted_round_robin") {
    const totalWeight = members.reduce((sum, m) => sum + (m.weight || 0), 0)
    const colors = [
      "bg-primary",
      "bg-sky-500",
      "bg-amber-500",
      "bg-emerald-500",
      "bg-indigo-500",
      "bg-rose-500",
      "bg-teal-500",
    ]

    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-semibold">
                Traffic Distribution Breakdown
              </CardTitle>
              <Badge
                variant="outline"
                className="border-amber-500/40 font-mono text-xs text-amber-600 dark:text-amber-400"
              >
                <IconScale className="mr-1 size-3" />
                Weighted Round Robin
              </Badge>
            </div>
            <span className="text-xs text-muted-foreground">
              Total weight: {totalWeight}
            </span>
          </div>
          <CardDescription className="text-xs">
            Inbound traffic is split across candidates proportional to weight.
            If a candidate encounters exhaustion, traffic falls over to the
            remaining routes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
            {members.map((member, i) => {
              const pct =
                totalWeight > 0 ? (member.weight / totalWeight) * 100 : 0
              if (pct <= 0) return null
              const color = colors[i % colors.length]
              return (
                <div
                  key={member.id}
                  className={`${color} transition-all`}
                  style={{ width: `${pct}%` }}
                  title={`${member.provider_model_id_public}: ${pct.toFixed(1)}%`}
                />
              )
            })}
          </div>
          <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((member, i) => {
              const pct =
                totalWeight > 0 ? (member.weight / totalWeight) * 100 : 0
              const color = colors[i % colors.length]
              return (
                <div
                  key={member.id}
                  className="flex items-center justify-between rounded-md border bg-muted/30 p-2 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={`size-2.5 shrink-0 rounded-full ${color}`}
                    />
                    <div className="min-w-0">
                      <p className="truncate font-mono font-medium text-foreground">
                        {member.provider_model_id_public}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {member.provider_name}
                      </p>
                    </div>
                  </div>
                  <div className="pl-2 text-right">
                    <span className="font-mono font-semibold text-foreground tabular-nums">
                      {pct.toFixed(1)}%
                    </span>
                    <p className="text-[10px] text-muted-foreground">
                      weight {member.weight}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    )
  }

  // round_robin
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-semibold">
              Cyclic Load-Balancing Pipeline
            </CardTitle>
            <Badge
              variant="outline"
              className="font-mono text-xs text-muted-foreground"
            >
              <IconRefresh className="mr-1 size-3" />
              Round Robin
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground">
            {members.length}{" "}
            {members.length === 1 ? "route member" : "rotating members"}
          </span>
        </div>
        <CardDescription className="text-xs">
          Requests rotate cyclically across all eligible candidate models. If a
          candidate is exhausted, traffic automatically advances to the next
          member.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {members.map((member, i) => (
            <div
              key={member.id}
              className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs"
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[11px] font-semibold text-primary">
                {i + 1}
              </span>
              <div className="flex flex-col">
                <code className="font-mono font-medium">
                  {member.provider_model_id_public}
                </code>
                <span className="text-[11px] text-muted-foreground">
                  {member.provider_name}
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

class DetailErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  render() {
    if (this.state.hasError) {
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
              <CardTitle>Error displaying model group</CardTitle>
              <CardDescription>
                {this.state.error?.message ??
                  "An unexpected rendering error occurred."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => window.location.reload()}>
                Reload page
              </Button>
            </CardContent>
          </Card>
        </div>
      )
    }
    return this.props.children
  }
}

function ModelGroupDetailInner() {
  const [groupId, setGroupId] = React.useState<string | null>(() => {
    if (typeof window === "undefined") return null
    return new URLSearchParams(window.location.search).get("id")
  })

  React.useEffect(() => {
    function syncId() {
      const id = new URLSearchParams(window.location.search).get("id")
      setGroupId((prev) => (prev !== id ? id : prev))
    }
    window.addEventListener("popstate", syncId)
    document.addEventListener("astro:page-load", syncId)
    syncId()
    return () => {
      window.removeEventListener("popstate", syncId)
      document.removeEventListener("astro:page-load", syncId)
    }
  }, [])
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

  const totalMemberWeight = React.useMemo(() => {
    return (group?.members ?? []).reduce((sum, m) => sum + (m.weight || 0), 0)
  }, [group?.members])

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

  const hasEligibleMember = (group.members ?? []).some(
    (member) => member.is_available
  )

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
                  <StrategyBadge strategy={group.routing_strategy} />
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
        <RoutingPipelineVisualizer group={group} />
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
              {(group.members ?? []).length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No members yet. Add a synced provider model to route across.
                  </TableCell>
                </TableRow>
              ) : (
                (group.members ?? []).map((member) => (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-semibold">
                          {member.priority}
                        </span>
                        {group.routing_strategy === "priority" ? (
                          <Badge
                            variant="outline"
                            className={
                              member.priority === 1
                                ? "border-sky-500/50 bg-sky-500/10 px-1 py-0 text-[10px] font-medium text-sky-600 dark:text-sky-400"
                                : "px-1 py-0 text-[10px] text-muted-foreground"
                            }
                          >
                            {member.priority === 1
                              ? "Primary"
                              : `Fallback #${member.priority - 1}`}
                          </Badge>
                        ) : null}
                      </div>
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
                      <span className="font-mono text-xs">{member.weight}</span>
                      {group.routing_strategy === "weighted_round_robin" &&
                      totalMemberWeight > 0 ? (
                        <span className="ml-1.5 font-mono text-[11px] text-primary">
                          (
                          {((member.weight / totalMemberWeight) * 100).toFixed(
                            0
                          )}
                          %)
                        </span>
                      ) : null}
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

export function ModelGroupDetailContent() {
  return (
    <DetailErrorBoundary>
      <ModelGroupDetailInner />
    </DetailErrorBoundary>
  )
}
