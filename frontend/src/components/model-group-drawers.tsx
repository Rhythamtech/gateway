import * as React from "react"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  ApiError,
  addModelGroupMember,
  createModelGroup,
  deleteModelGroupMember,
  listProviderModels,
  listProviders,
  updateModelGroup,
  updateModelGroupMember,
  type ModelGroup,
  type ModelGroupInput,
  type ModelGroupMember,
  type ModelGroupUpdate,
  type ProviderModel,
  type RoutingStrategy,
} from "@/lib/auth"
import { IconPlus, IconX } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// Mirrors the backend model_id validator: "{alias}/{model}" where the alias
// part matches the provider alias rules and the model part has no whitespace.
const GROUP_MODEL_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._-]*/\\S+$"
const GROUP_MODEL_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]*\/\S+$/

// Drawers for model groups. All use the shared drawer chrome from the
// provider drawers: pinned header, scrollable body, pinned footer.
type ModelFormDrawerProps = {
  open: boolean
  group: ModelGroup | null
  initialModel?: ProviderModel
  onClose: () => void
  onSaved: (group: ModelGroup) => void
}

type MemberRow = {
  providerId: string
  providerModelId: string
  weight: string
  priority: string
}

function parsePositiveInt(value: string) {
  const trimmed = value.trim()
  if (!/^[1-9][0-9]*$/.test(trimmed)) return null
  return Number(trimmed)
}

export function ModelGroupFormDrawer({
  open,
  group,
  initialModel,
  onClose,
  onSaved,
}: ModelFormDrawerProps) {
  const isMobile = useIsMobile()
  const isEdit = group !== null

  const [name, setName] = React.useState(
    () => group?.name ?? initialModel?.model_name ?? ""
  )
  const [modelId, setModelId] = React.useState(
    () => group?.model_id ?? initialModel?.model_id ?? ""
  )
  const [modelIdTouched, setModelIdTouched] = React.useState(false)
  const [strategy, setStrategy] = React.useState<RoutingStrategy>(
    () => group?.routing_strategy ?? "round_robin"
  )
  const [enabled, setEnabled] = React.useState(() => group?.is_enabled ?? true)
  const [memberRows, setMemberRows] = React.useState<
    { key: number; row: MemberRow }[]
  >(() =>
    initialModel && !group
      ? [
          {
            key: 0,
            row: {
              providerId: initialModel.provider_id,
              providerModelId: initialModel.id,
              weight: "1",
              priority: "1",
            },
          },
        ]
      : []
  )
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)
  const [providers, setProviders] = React.useState<Awaited<
    ReturnType<typeof listProviders>
  > | null>(null)
  const [modelsByProvider, setModelsByProvider] = React.useState<
    Record<string, Awaited<ReturnType<typeof listProviderModels>>>
  >(() => (initialModel ? { [initialModel.provider_id]: [initialModel] } : {}))
  const nextKey = React.useRef(1)

  const totalWeight = React.useMemo(() => {
    return memberRows.reduce((sum, entry) => {
      const w = parsePositiveInt(entry.row.weight)
      return sum + (w ?? 0)
    }, 0)
  }, [memberRows])

  React.useEffect(() => {
    let cancelled = false

    listProviders()
      .then((result) => {
        if (cancelled) return
        setProviders(result)
      })
      .catch(() => {
        if (cancelled) return
        setProviders([])
      })

    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    if (!isEdit || !group || providers === null) return
    let cancelled = false

    // Pre-adding existing members keeps them visible in the form; each row
    // shows persisted weights and priorities so an edit ships a replacement.
    const preloadRows = group.members.map((member) => ({
      key: nextKey.current++,
      row: {
        providerId: member.provider_id,
        providerModelId: member.provider_model_id,
        weight: String(member.weight),
        priority: String(member.priority),
      } satisfies MemberRow,
    }))
    setMemberRows(preloadRows)

    const providerIds = Array.from(
      new Set(group.members.map((member) => member.provider_id))
    )
    Promise.all(
      providerIds.map((providerId) =>
        listProviderModels(providerId).then((models) => [providerId, models])
      )
    )
      .then((entries) => {
        if (cancelled) return
        setModelsByProvider(Object.fromEntries(entries))
      })
      .catch(() => {
        if (cancelled) return
        // Model names are still readable from the group response.
        setModelsByProvider({})
      })

    return () => {
      cancelled = true
    }
    // Providers only gate the availability hint; group is stable per drawer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, group?.id])

  function addRow() {
    setMemberRows((rows) => [
      ...rows,
      {
        key: nextKey.current++,
        row: {
          providerId: "",
          providerModelId: "",
          weight: "1",
          priority: "1",
        },
      },
    ])
  }

  function removeRow(key: number) {
    setMemberRows((rows) => rows.filter((entry) => entry.key !== key))
  }

  function setRow(key: number, patch: Partial<MemberRow>) {
    setMemberRows((rows) =>
      rows.map((entry) =>
        entry.key === key
          ? { ...entry, row: { ...entry.row, ...patch } }
          : entry
      )
    )
  }

  // Selecting a member's model also suggests the group's public model ID
  // (which must be "{provider-alias}/{model}") until the user has typed
  // something of their own.
  function chooseRowModel(
    key: number,
    providerId: string,
    providerModelId: string
  ) {
    setRow(key, { providerModelId })
    if (modelIdTouched || modelId.trim() !== "") return

    const model = (modelsByProvider[providerId] ?? []).find(
      (item) => item.id === providerModelId
    )
    if (model) setModelId(model.model_id)
  }

  function setProviderForRow(key: number, providerId: string) {
    setRow(key, { providerId, providerModelId: "" })
    if (!providerId) return

    // Cache model lists per provider; keep any existing (good or empty)
    // entry so a slower later request cannot clobber it.
    listProviderModels(providerId)
      .then((models) => {
        setModelsByProvider((existing) =>
          existing[providerId]
            ? existing
            : { ...existing, [providerId]: models }
        )
      })
      .catch(() => {
        setModelsByProvider((existing) =>
          existing[providerId] ? existing : { ...existing, [providerId]: [] }
        )
      })
  }

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextName = name.trim()
    const nextModelId = modelId.trim()

    if (!nextName) {
      setError("Enter a group name.")
      return
    }
    if (!GROUP_MODEL_ID_REGEX.test(nextModelId)) {
      setError(
        "Enter a model ID in the alias/model-name format, e.g. openai/gpt-4o-mini."
      )
      return
    }

    const memberIds = memberRows.map((entry) => entry.row.providerModelId)
    if (memberIds.some((id) => !id)) {
      setError("Choose a provider model for every member row.")
      return
    }
    if (new Set(memberIds).size !== memberIds.length) {
      setError("Each provider model can be added to the group only once.")
      return
    }
    const parsedMembers = memberRows.map((entry) => ({
      row: entry.row,
      weight: parsePositiveInt(entry.row.weight),
      priority: parsePositiveInt(entry.row.priority),
    }))
    if (parsedMembers.some((member) => member.weight === null)) {
      setError("Member weight must be a whole number of 1 or more.")
      return
    }
    if (parsedMembers.some((member) => member.priority === null)) {
      setError("Member priority must be a whole number of 1 or more.")
      return
    }

    // The backend rejects enabled groups without an eligible member: the
    // model must be available and its provider enabled. Check up front so
    // the message names the fix instead of surfacing a 422.
    if (enabled) {
      if (memberRows.length === 0) {
        setError(
          "Add at least one member, or uncheck Enabled to create a disabled group."
        )
        return
      }
      const eligibilities = memberRows.map((entry) => {
        const provider = providers?.find(
          (item) => item.id === entry.row.providerId
        )
        const model = Object.values(modelsByProvider)
          .flat()
          .find((item) => item.id === entry.row.providerModelId)
        return Boolean(provider?.is_enabled && model?.is_available)
      })
      if (!eligibilities.some(Boolean)) {
        setError(
          "An enabled group needs at least one available member on an enabled provider. Uncheck Enabled or pick an available model."
        )
        return
      }
    }

    setPending(true)
    setError(null)

    const members = parsedMembers.map((member) => ({
      provider_model_id: member.row.providerModelId,
      weight: member.weight as number,
      priority: member.priority as number,
    }))

    try {
      const input: ModelGroupInput = {
        name: nextName,
        model_id: nextModelId,
        routing_strategy: strategy,
        is_enabled: enabled,
        members,
      }

      if (isEdit && group) {
        const changes: ModelGroupUpdate = {}
        if (nextName !== group.name) changes.name = nextName
        if (nextModelId !== group.model_id) changes.model_id = nextModelId
        if (strategy !== group.routing_strategy) {
          changes.routing_strategy = strategy
        }
        if (enabled !== group.is_enabled) changes.is_enabled = enabled
        changes.members = members

        onSaved(await updateModelGroup(group.id, changes))
        return
      }

      onSaved(await createModelGroup(input))
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : "Unable to save the model group."
      )
    } finally {
      setPending(false)
    }
  }

  const firstModelIdRow = memberRows.find(
    (entry) => entry.row.providerId !== ""
  )
  const suggestedAlias = providers?.find(
    (item) => item.id === firstModelIdRow?.row.providerId
  )?.aliases
  const nextModelId = modelId.trim()
  const modelIdInvalid =
    nextModelId !== "" && !GROUP_MODEL_ID_REGEX.test(nextModelId)

  return (
    <Drawer
      direction={isMobile ? "bottom" : "right"}
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DrawerContent>
        <DrawerHeader className="shrink-0 gap-1 border-b">
          <DrawerTitle>
            {isEdit ? "Edit model group" : "Create model group"}
          </DrawerTitle>
          <DrawerDescription>
            {isEdit
              ? "Update group settings. Saving replaces the member list."
              : "Group provider models behind one public model ID."}
          </DrawerDescription>
        </DrawerHeader>
        <form
          id="model-group-form"
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-2 text-sm"
          onSubmit={handleSubmit}
        >
          <div className="flex flex-col gap-3">
            <Label htmlFor="model-group-name">Name</Label>
            <Input
              id="model-group-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={255}
              required
              autoFocus={!isEdit}
            />
          </div>
          <div className="flex flex-col gap-3">
            <Label htmlFor="model-group-model-id">Public model ID</Label>
            <Input
              id="model-group-model-id"
              value={modelId}
              onChange={(event) => {
                setModelIdTouched(true)
                setModelId(event.target.value)
              }}
              pattern={GROUP_MODEL_ID_PATTERN}
              maxLength={320}
              placeholder="openai/gpt-4o-mini"
              required
            />
            <p className="text-xs text-muted-foreground">
              Sent to API clients as the model name. Must be unique and follow
              the provider-alias/model format.
            </p>
            {modelIdInvalid ? (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {suggestedAlias
                  ? `Prefix it with this gateway's provider alias — e.g. “${suggestedAlias}/model-name”.`
                  : "Include the provider-alias prefix, e.g. openai/gpt-4o-mini."}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-3">
            <Label htmlFor="model-group-strategy">Routing strategy</Label>
            <Select
              value={strategy}
              onValueChange={(value) => setStrategy(value as RoutingStrategy)}
            >
              <SelectTrigger id="model-group-strategy" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="round_robin">
                  Round robin (Cyclic rotation)
                </SelectItem>
                <SelectItem value="weighted_round_robin">
                  Weighted round robin (Traffic share)
                </SelectItem>
                <SelectItem value="runtime_fallback">
                  Runtime Fallback
                </SelectItem>
              </SelectContent>
            </Select>
            {strategy === "runtime_fallback" ? (
              <p className="text-xs text-muted-foreground">
                Tries members in priority order. If a provider has a retryable
                error before accepting the request, Gateway tries the next
                member. Higher weight breaks priority ties.
              </p>
            ) : strategy === "weighted_round_robin" ? (
              <p className="text-xs text-muted-foreground">
                Traffic is distributed probabilistically across eligible members
                proportional to their weight. If the chosen candidate is
                unavailable, routing falls over to the remaining candidates.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Requests rotate cyclically across eligible members in
                round-robin order, advancing to the next candidate if one is
                unavailable.
              </p>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              id="model-group-enabled"
              checked={enabled}
              onCheckedChange={(value) => setEnabled(value === true)}
            />
            Enabled
          </label>
          <Separator />
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="model-group-members">Members</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRow}
              >
                <IconPlus />
                Add member
              </Button>
            </div>
            {memberRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Pick synced provider models to route across. Weight sets each
                member&apos;s traffic share in weighted round-robin mode;
                priority sets the failover order — lower numbers are tried
                first.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {memberRows.map((entry) => {
                  const provider = providers?.find(
                    (item) => item.id === entry.row.providerId
                  )
                  const model = Object.values(modelsByProvider)
                    .flat()
                    .find((item) => item.id === entry.row.providerModelId)
                  const eligible = Boolean(
                    provider?.is_enabled && model?.is_available
                  )

                  return (
                    <div
                      className="flex flex-col gap-2 rounded-md border bg-muted/30 p-2"
                      key={entry.key}
                    >
                      <div className="grid grid-cols-2 gap-2">
                        <Select
                          value={entry.row.providerId}
                          onValueChange={(value) =>
                            setProviderForRow(entry.key, value)
                          }
                        >
                          <SelectTrigger
                            aria-label={`Member ${entry.key} provider`}
                            className="w-full"
                          >
                            <SelectValue placeholder="Provider" />
                          </SelectTrigger>
                          <SelectContent>
                            {providers?.map((item) => (
                              <SelectItem key={item.id} value={item.id}>
                                {item.name}
                                {item.is_enabled ? "" : " (disabled)"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={entry.row.providerModelId}
                          onValueChange={(value) =>
                            chooseRowModel(
                              entry.key,
                              entry.row.providerId,
                              value
                            )
                          }
                        >
                          <SelectTrigger
                            aria-label={`Member ${entry.key} model`}
                            className="w-full"
                          >
                            <SelectValue placeholder="Model" />
                          </SelectTrigger>
                          <SelectContent>
                            {(modelsByProvider[entry.row.providerId] ?? []).map(
                              (item) => (
                                <SelectItem key={item.id} value={item.id}>
                                  {item.model_name}
                                  {item.is_available ? "" : " (unavailable)"}
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div
                        className={
                          strategy === "round_robin"
                            ? "grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2"
                            : "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2"
                        }
                      >
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between">
                            <Label
                              className="text-xs text-muted-foreground"
                              htmlFor={`member-priority-${entry.key}`}
                            >
                              Priority
                            </Label>
                            {strategy === "runtime_fallback" &&
                            parsePositiveInt(entry.row.priority) !== null ? (
                              <span className="font-mono text-[10px] text-sky-600 dark:text-sky-400">
                                {parsePositiveInt(entry.row.priority) === 1
                                  ? "#1 Primary"
                                  : `#${entry.row.priority} Fallback`}
                              </span>
                            ) : null}
                          </div>
                          <Input
                            id={`member-priority-${entry.key}`}
                            type="number"
                            min={1}
                            step={1}
                            className="h-8"
                            value={entry.row.priority}
                            onChange={(event) =>
                              setRow(entry.key, {
                                priority: event.target.value,
                              })
                            }
                          />
                        </div>
                        {strategy === "weighted_round_robin" ||
                        strategy === "runtime_fallback" ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center justify-between">
                              <Label
                                className="text-xs text-muted-foreground"
                                htmlFor={`member-weight-${entry.key}`}
                              >
                                {strategy === "runtime_fallback"
                                  ? "Tie-break weight"
                                  : "Weight"}
                              </Label>
                              {strategy === "weighted_round_robin" &&
                              totalWeight > 0 &&
                              parsePositiveInt(entry.row.weight) !== null ? (
                                <span className="font-mono text-[10px] text-primary">
                                  {(
                                    ((parsePositiveInt(entry.row.weight) ?? 0) /
                                      totalWeight) *
                                    100
                                  ).toFixed(0)}
                                  % traffic
                                </span>
                              ) : null}
                            </div>
                            <Input
                              id={`member-weight-${entry.key}`}
                              type="number"
                              min={1}
                              step={1}
                              className="h-8"
                              value={entry.row.weight}
                              onChange={(event) =>
                                setRow(entry.key, {
                                  weight: event.target.value,
                                })
                              }
                            />
                          </div>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground"
                          onClick={() => removeRow(entry.key)}
                        >
                          <IconX />
                          <span className="sr-only">Remove member</span>
                        </Button>
                      </div>
                      {model && provider ? (
                        <p
                          className={
                            eligible
                              ? "text-xs text-muted-foreground"
                              : "text-xs text-amber-700 dark:text-amber-400"
                          }
                        >
                          {eligible
                            ? "Eligible for routing."
                            : "Not eligible — needs an available model on an enabled provider."}
                        </p>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </form>
        <DrawerFooter
          className="shrink-0 border-t"
          style={{
            paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
          }}
        >
          <Button type="submit" form="model-group-form" disabled={pending}>
            {pending
              ? isEdit
                ? "Saving…"
                : "Creating…"
              : isEdit
                ? "Save changes"
                : "Create group"}
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

type ModelGroupActionDrawerProps = {
  group: ModelGroup
  onClose: () => void
  onDone: () => void
}

export function ModelGroupActionDrawer({
  group,
  onClose,
  onDone,
}: ModelGroupActionDrawerProps) {
  const isMobile = useIsMobile()
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  async function handleConfirm() {
    setPending(true)
    setError(null)

    try {
      await updateModelGroup(group.id, { is_enabled: false })
      onDone()
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : "Unable to complete the action."
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
          <DrawerTitle>Disable “{group.name}”?</DrawerTitle>
          <DrawerDescription>
            The group&apos;s public model ID stops resolving for inference.
            Members are kept and the group can be re-enabled. The backend does
            not expose group deletion.
          </DrawerDescription>
        </DrawerHeader>
        {error ? (
          <p className="px-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DrawerFooter>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Disabling…" : "Disable group"}
          </Button>
          <DrawerClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

type ModelGroupMemberFormDrawerProps = {
  open: boolean
  groupId: string
  initialModel?: ProviderModel
  // Null while adding a member; set while editing an existing one.
  member: ModelGroupMember | null
  onClose: () => void
  onSaved: (group: ModelGroup) => void
}

export function ModelGroupMemberFormDrawer({
  open,
  groupId,
  initialModel,
  member,
  onClose,
  onSaved,
}: ModelGroupMemberFormDrawerProps) {
  const isMobile = useIsMobile()
  const isEdit = member !== null

  const [providers, setProviders] = React.useState<Awaited<
    ReturnType<typeof listProviders>
  > | null>(null)
  const [providerId, setProviderId] = React.useState(
    () => member?.provider_id ?? initialModel?.provider_id ?? ""
  )
  const [models, setModels] = React.useState<Awaited<
    ReturnType<typeof listProviderModels>
  > | null>(null)
  const [providerModelId, setProviderModelId] = React.useState(
    () => member?.provider_model_id ?? initialModel?.id ?? ""
  )
  const [weight, setWeight] = React.useState(() =>
    member ? String(member.weight) : "1"
  )
  const [priority, setPriority] = React.useState(() =>
    member ? String(member.priority) : "1"
  )
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false

    listProviders()
      .then((result) => {
        if (cancelled) return
        setProviders(result)
      })
      .catch(() => {
        if (cancelled) return
        setProviders([])
      })

    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    if (!providerId) return
    let cancelled = false

    listProviderModels(providerId)
      .then((result) => {
        if (cancelled) return
        setModels(result)
      })
      .catch(() => {
        if (cancelled) return
        setModels([])
      })

    return () => {
      cancelled = true
    }
  }, [providerId])

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!isEdit && !providerModelId) {
      setError("Choose a provider model to add.")
      return
    }
    const nextWeight = parsePositiveInt(weight)
    const nextPriority = parsePositiveInt(priority)
    if (nextWeight === null) {
      setError("Weight must be a whole number of 1 or more.")
      return
    }
    if (nextPriority === null) {
      setError("Priority must be a whole number of 1 or more.")
      return
    }

    setPending(true)
    setError(null)

    try {
      if (isEdit && member) {
        onSaved(
          await updateModelGroupMember(groupId, member.id, {
            weight: nextWeight,
            priority: nextPriority,
          })
        )
        return
      }

      onSaved(
        await addModelGroupMember(groupId, {
          provider_model_id: providerModelId,
          weight: nextWeight,
          priority: nextPriority,
        })
      )
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : "Unable to save the member."
      )
    } finally {
      setPending(false)
    }
  }

  const selectedProvider = providers?.find((item) => item.id === providerId)
  const selectedModel = models?.find((item) => item.id === providerModelId)
  const eligible = Boolean(
    selectedProvider?.is_enabled && selectedModel?.is_available
  )

  return (
    <Drawer
      direction={isMobile ? "bottom" : "right"}
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DrawerContent>
        <DrawerHeader className="shrink-0 gap-1 border-b">
          <DrawerTitle>{isEdit ? "Edit member" : "Add member"}</DrawerTitle>
          <DrawerDescription>
            {isEdit
              ? "Adjust this member's weight and routing priority."
              : "Pick a synced provider model and set its routing priority."}
          </DrawerDescription>
        </DrawerHeader>
        <form
          id="member-form"
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-2 text-sm"
          onSubmit={handleSubmit}
        >
          {isEdit && member ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-muted-foreground">Member</p>
              <code className="font-mono text-xs">
                {member.provider_model_id_public}
              </code>
              <p className="text-xs text-muted-foreground">
                From {member.provider_name} ({member.provider_alias}).
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                <Label htmlFor="member-provider">Provider</Label>
                <Select
                  value={providerId}
                  onValueChange={(value) => {
                    setProviderId(value)
                    setProviderModelId("")
                    setModels(null)
                  }}
                >
                  <SelectTrigger id="member-provider" className="w-full">
                    <SelectValue placeholder="Select a provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers?.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                        {item.is_enabled ? "" : " (disabled)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-3">
                <Label htmlFor="member-model">Provider model</Label>
                <Select
                  value={providerModelId}
                  onValueChange={setProviderModelId}
                  disabled={!providerId}
                >
                  <SelectTrigger id="member-model" className="w-full">
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                  <SelectContent>
                    {(models ?? []).map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.model_name}
                        {item.is_available ? "" : " (unavailable)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!providerId ? (
                  <p className="text-xs text-muted-foreground">
                    Choose a provider to load its synced models.
                  </p>
                ) : (models ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    This provider has no synced models yet.
                  </p>
                ) : null}
                {selectedModel && selectedProvider && !eligible ? (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Unavailable on an enabled provider — the group still saves,
                    but stays unroutable until a member is eligible.
                  </p>
                ) : null}
              </div>
            </>
          )}
          <div className="flex flex-col gap-3">
            <Label htmlFor="member-weight">Weight</Label>
            <Input
              id="member-weight"
              type="number"
              min={1}
              step={1}
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              Traffic share when the group routes with weighted round-robin.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Label htmlFor="member-priority">Priority</Label>
            <Input
              id="member-priority"
              type="number"
              min={1}
              step={1}
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              Failover tries members in ascending priority order: 1 is Primary,
              2 is Fallback 1, etc.
            </p>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </form>
        <DrawerFooter
          className="shrink-0 border-t"
          style={{
            paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
          }}
        >
          <Button type="submit" form="member-form" disabled={pending}>
            {pending
              ? isEdit
                ? "Saving…"
                : "Adding…"
              : isEdit
                ? "Save changes"
                : "Add member"}
          </Button>
          <DrawerClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

type ModelGroupMemberActionDrawerProps = {
  groupId: string
  member: ModelGroupMember
  onClose: () => void
  onDone: () => void
}

export function ModelGroupMemberActionDrawer({
  groupId,
  member,
  onClose,
  onDone,
}: ModelGroupMemberActionDrawerProps) {
  const isMobile = useIsMobile()
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  async function handleConfirm() {
    setPending(true)
    setError(null)

    try {
      await deleteModelGroupMember(groupId, member.id)
      onDone()
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : "Unable to complete the action."
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
          <DrawerTitle>Remove member?</DrawerTitle>
          <DrawerDescription>
            Removes {member.provider_name} · {member.provider_model_id_public}{" "}
            from the group. This cannot be undone.
          </DrawerDescription>
        </DrawerHeader>
        {error ? (
          <p className="px-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DrawerFooter>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Removing…" : "Remove member"}
          </Button>
          <DrawerClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
