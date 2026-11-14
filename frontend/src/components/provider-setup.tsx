import * as React from "react"
import {
  getModelCreditRate,
  getProviderCredits,
  listModelGroups,
  listProviderModels,
  syncProviderModels,
  type CreditBalance,
  type ModelCreditRate,
  type ModelGroup,
  type Provider,
  type ProviderModel,
} from "@/lib/auth"
import { formatCredits, isMissingRateError, isZeroCredits } from "@/lib/credits"
import {
  CreditFundingDrawer,
  ModelRateDrawer,
} from "@/components/credit-drawers"
import {
  ModelGroupFormDrawer,
  ModelGroupMemberFormDrawer,
} from "@/components/model-group-drawers"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type Progress = { selected: string[]; step: number }
type RateState =
  | { kind: "loaded"; rate: ModelCreditRate }
  | { kind: "missing" }
  | { kind: "error"; message: string }
type Drawer =
  | { kind: "rate"; model: ProviderModel }
  | { kind: "create"; model: ProviderModel }
  | { kind: "member"; model: ProviderModel; group: ModelGroup }
  | { kind: "fund" }
  | null
const steps = ["Select models", "Credit rates", "Model groups", "Review"]

function readProgress(key: string): Progress {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null")
    if (
      value &&
      Array.isArray(value.selected) &&
      value.selected.every((id: unknown) => typeof id === "string")
    ) {
      return {
        selected: [...new Set<string>(value.selected)],
        step: Number.isInteger(value.step)
          ? Math.max(0, Math.min(3, value.step))
          : 0,
      }
    }
  } catch {
    /* Setup still works when session storage is unavailable. */
  }
  return { selected: [], step: 0 }
}
function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request failed. Try again."
}

export function ProviderSetup({
  provider,
  onExit,
}: {
  provider: Provider
  onExit: () => void
}) {
  const storageKey = `provider-setup:${provider.id}`
  const [progress, setProgress] = React.useState(() => readProgress(storageKey))
  const [models, setModels] = React.useState<ProviderModel[] | null>(null)
  const [modelError, setModelError] = React.useState<string | null>(null)
  const [initialSync] = React.useState(
    () => new URLSearchParams(window.location.search).get("sync") === "1"
  )
  const [syncing, setSyncing] = React.useState(false)
  const syncLock = React.useRef(false)
  const initialLoad = React.useRef<Promise<ProviderModel[]> | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState("")
  const [rates, setRates] = React.useState<Record<string, RateState>>({})
  const [rateTick, setRateTick] = React.useState(0)
  const rateRevisions = React.useRef<Record<string, number>>({})
  const [groups, setGroups] = React.useState<ModelGroup[] | null>(null)
  const [groupError, setGroupError] = React.useState<string | null>(null)
  const [groupTick, setGroupTick] = React.useState(0)
  const [balance, setBalance] = React.useState<CreditBalance | null>(null)
  const [balanceError, setBalanceError] = React.useState<string | null>(null)
  const [balanceTick, setBalanceTick] = React.useState(0)
  const [drawer, setDrawer] = React.useState<Drawer>(null)
  const heading = React.useRef<HTMLHeadingElement>(null)

  React.useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(progress))
    } catch {
      /* Optional session persistence. */
    }
  }, [progress, storageKey])

  const applyModels = React.useCallback((result: ProviderModel[]) => {
    setModels(result)
    setModelError(null)
    setProgress((current) => {
      const selected = current.selected.filter((id) =>
        result.some((model) => model.id === id && model.is_available)
      )
      return selected.length === current.selected.length
        ? current
        : { selected, step: 0 }
    })
  }, [])

  React.useEffect(() => {
    let cancelled = false
    if (!initialLoad.current) {
      const url = new URL(window.location.href)
      const shouldSync = url.searchParams.get("sync") === "1"
      url.searchParams.delete("sync")
      window.history.replaceState(null, "", url)
      initialLoad.current = (async () => {
        if (shouldSync) await syncProviderModels(provider.id)
        return listProviderModels(provider.id)
      })()
    }
    initialLoad.current
      .then((result) => {
        if (!cancelled) applyModels(result)
      })
      .catch((error: unknown) => {
        if (!cancelled) setModelError(message(error))
      })
    return () => {
      cancelled = true
    }
  }, [provider.id, applyModels])

  async function sync() {
    if (syncLock.current) return
    syncLock.current = true
    setSyncing(true)
    setModelError(null)
    try {
      const result = await syncProviderModels(provider.id)
      const latest = await listProviderModels(provider.id)
      const removed = progress.selected.some(
        (id) => !latest.some((model) => model.id === id && model.is_available)
      )
      applyModels(latest)
      setNotice(
        `${result.synced} models found.${removed ? " Unavailable models were removed from your selection. Review your selection before continuing." : " Existing rates and group memberships are preserved."}`
      )
    } catch (error) {
      setModelError(message(error))
    } finally {
      syncLock.current = false
      setSyncing(false)
    }
  }

  React.useEffect(() => {
    let cancelled = false
    // Bound requests to avoid flooding the API for a large selection.
    async function load() {
      for (let offset = 0; offset < progress.selected.length; offset += 6) {
        await Promise.all(
          progress.selected.slice(offset, offset + 6).map(async (id) => {
            const revision = rateRevisions.current[id] ?? 0
            let state: RateState
            try {
              state = { kind: "loaded", rate: await getModelCreditRate(id) }
            } catch (error) {
              state = isMissingRateError(error)
                ? { kind: "missing" }
                : { kind: "error", message: message(error) }
            }
            if (!cancelled && revision === (rateRevisions.current[id] ?? 0)) {
              setRates((current) => ({ ...current, [id]: state }))
            }
          })
        )
        if (cancelled) return
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [progress.selected, rateTick])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      const all: ModelGroup[] = []
      for (let page = 1; ; page++) {
        const result = await listModelGroups({ page, pageSize: 100 })
        if (cancelled) return
        all.push(...result.items)
        if (all.length >= result.total || result.items.length === 0) break
      }
      if (!cancelled) {
        setGroups(all)
        setGroupError(null)
      }
    }
    void load().catch((error: unknown) => {
      if (!cancelled) setGroupError(message(error))
    })
    return () => {
      cancelled = true
    }
  }, [groupTick])

  React.useEffect(() => {
    let cancelled = false
    getProviderCredits(provider.id)
      .then((result) => {
        if (!cancelled) {
          setBalance(result)
          setBalanceError(null)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setBalanceError(message(error))
      })
    return () => {
      cancelled = true
    }
  }, [provider.id, balanceTick])

  const selected = (models ?? []).filter(
    (model) => model.is_available && progress.selected.includes(model.id)
  )
  const ratesReady =
    selected.length > 0 &&
    selected.every((model) => rates[model.id]?.kind === "loaded")
  const memberships = (id: string) =>
    (groups ?? []).filter((group) =>
      group.members.some((member) => member.provider_model_id === id)
    )
  const groupsReady =
    groups !== null &&
    groupError === null &&
    selected.every((model) => memberships(model.id).length > 0)
  const step =
    models === null || !selected.length
      ? 0
      : progress.step >= 2 && !ratesReady
        ? 1
        : progress.step === 3 && !groupsReady
          ? 2
          : progress.step
  const canContinue =
    !syncing &&
    modelError === null &&
    (step === 0 ? selected.length > 0 : step === 1 ? ratesReady : groupsReady)

  React.useEffect(() => {
    heading.current?.focus()
  }, [step])

  function goTo(next: number) {
    setProgress((current) => ({ ...current, step: next }))
  }
  function savedGroup(group: ModelGroup) {
    setGroups((current) => [
      group,
      ...(current ?? []).filter((item) => item.id !== group.id),
    ])
    setDrawer(null)
    setGroupTick((tick) => tick + 1)
  }

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <Card>
        <CardHeader>
          <CardTitle>Set up {provider.name}</CardTitle>
          <CardDescription>
            Provider added. Choose the models to offer, set their credit rates,
            and assign model groups.
          </CardDescription>
          <ol
            aria-label="Provider setup progress"
            className="flex flex-wrap gap-3 text-sm"
          >
            {steps.map((label, index) => (
              <li
                key={label}
                aria-current={index === step ? "step" : undefined}
              >
                <Badge variant={index === step ? "default" : "outline"}>
                  {index + 1}. {label}
                </Badge>
              </li>
            ))}
          </ol>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <h2
            ref={heading}
            tabIndex={-1}
            className="text-lg font-semibold"
            aria-live="polite"
          >
            Step {step + 1}: {steps[step]}
          </h2>
          {!provider.is_enabled && (
            <p role="alert">
              This provider is disabled. Enable it from provider details before
              routing requests.
            </p>
          )}
          {step === 0 && (
            <>
              <p className="text-sm text-muted-foreground">
                All upstream models are imported. Select only the available
                models you want to configure. Other models can be configured
                later.
              </p>
              <Button
                variant="outline"
                onClick={() => void sync()}
                disabled={syncing || (models === null && modelError === null)}
              >
                {syncing
                  ? "Syncing models…"
                  : modelError
                    ? "Retry model sync"
                    : "Sync models"}
              </Button>
              {notice && <p role="status">{notice}</p>}
              {models === null && !modelError && (
                <p role="status">
                  {initialSync
                    ? "Syncing provider models…"
                    : "Loading provider models…"}
                </p>
              )}
              {models?.length === 0 && (
                <p>
                  No models found. Check the provider configuration and sync
                  again.
                </p>
              )}
              {modelError && (
                <p role="alert" className="text-destructive">
                  {modelError} The provider is saved; retry sync or finish later
                  to edit its settings.
                </p>
              )}
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="setup-model-search">
                    Search models
                  </FieldLabel>
                  <Input
                    id="setup-model-search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </Field>
                {models
                  ?.filter((model) =>
                    `${model.model_name} ${model.model_id}`
                      .toLowerCase()
                      .includes(query.toLowerCase())
                  )
                  .map((model) => (
                    <Field key={model.id} orientation="horizontal">
                      <Checkbox
                        id={`setup-${model.id}`}
                        disabled={!model.is_available || syncing}
                        checked={progress.selected.includes(model.id)}
                        onCheckedChange={(checked) =>
                          setProgress((current) => ({
                            step: 0,
                            selected:
                              checked === true
                                ? [...current.selected, model.id]
                                : current.selected.filter(
                                    (id) => id !== model.id
                                  ),
                          }))
                        }
                      />
                      <FieldLabel
                        htmlFor={`setup-${model.id}`}
                        className="min-w-0 break-all"
                      >
                        {model.model_name}
                        {!model.is_available && " (unavailable)"}
                      </FieldLabel>
                    </Field>
                  ))}
              </FieldGroup>
              {models &&
                models.length > 0 &&
                !models.some((model) =>
                  `${model.model_name} ${model.model_id}`
                    .toLowerCase()
                    .includes(query.toLowerCase())
                ) && <p role="status">No models match your search.</p>}
              <p role="status">{selected.length} models selected.</p>
            </>
          )}
          {step === 1 && (
            <>
              <p className="text-sm text-muted-foreground">
                Save a credit rate for each selected model. Existing configured
                rates are reused.
              </p>
              {selected.map((model) => {
                const state = rates[model.id]
                return (
                  <div
                    key={model.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium break-all">
                        {model.model_name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {state?.kind === "loaded"
                          ? `${state.rate.tokens_per_credit} tokens per credit`
                          : state?.kind === "missing"
                            ? "Rate required"
                            : state?.kind === "error"
                              ? "Unable to load rate"
                              : "Loading rate…"}
                      </p>
                      {state?.kind === "error" && (
                        <p role="alert" className="text-sm text-destructive">
                          {state.message}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => setDrawer({ kind: "rate", model })}
                    >
                      {state?.kind === "loaded"
                        ? "Edit rate"
                        : "Configure rate"}{" "}
                      <span className="sr-only">for {model.model_name}</span>
                    </Button>
                  </div>
                )
              })}
              {selected.some((model) => rates[model.id]?.kind === "error") && (
                <Button
                  variant="outline"
                  onClick={() => setRateTick((tick) => tick + 1)}
                >
                  Retry loading rates
                </Button>
              )}
            </>
          )}
          {step === 2 && (
            <>
              <p className="text-sm text-muted-foreground">
                Create a group for each model or add it to an existing group.
                Existing members and routing settings are preserved when adding
                a model.
              </p>
              {groups === null && !groupError && (
                <p role="status">Loading model groups…</p>
              )}
              {groupError && (
                <div role="alert">
                  <p className="text-destructive">{groupError}</p>
                  <Button
                    variant="outline"
                    onClick={() => setGroupTick((tick) => tick + 1)}
                  >
                    Retry loading groups
                  </Button>
                </div>
              )}
              {selected.map((model) => (
                <div
                  key={model.id}
                  className="flex flex-col gap-3 rounded-lg border p-3"
                >
                  <p className="font-medium break-all">{model.model_name}</p>
                  {memberships(model.id).map((group) => (
                    <div
                      key={group.id}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <Badge variant="secondary">
                        {group.name}
                        {!group.is_enabled && " (disabled)"}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setDrawer({ kind: "member", model, group })
                        }
                      >
                        Edit membership
                        <span className="sr-only">
                          {" "}
                          in {group.name} for {model.model_name}
                        </span>
                      </Button>
                      <Button variant="link" size="sm" asChild>
                        <a
                          href={`/dashboard/model-groups/detail?id=${encodeURIComponent(group.id)}`}
                        >
                          Edit group
                          <span className="sr-only"> {group.name}</span>
                        </a>
                      </Button>
                    </div>
                  ))}
                  {memberships(model.id).length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Group assignment required.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setDrawer({ kind: "create", model })}
                      disabled={groups === null || groupError !== null}
                    >
                      Create group
                      <span className="sr-only"> for {model.model_name}</span>
                    </Button>
                    <Select
                      value=""
                      onValueChange={(id) => {
                        const group = groups?.find((item) => item.id === id)
                        if (group) setDrawer({ kind: "member", model, group })
                      }}
                      disabled={
                        groups === null ||
                        groupError !== null ||
                        !groups.some(
                          (group) =>
                            !group.members.some(
                              (member) => member.provider_model_id === model.id
                            )
                        )
                      }
                    >
                      <SelectTrigger
                        aria-label={`Add ${model.model_name} to existing group`}
                        className="w-full sm:w-64"
                      >
                        <SelectValue placeholder="Add to existing group" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {groups
                            ?.filter(
                              (group) =>
                                !group.members.some(
                                  (member) =>
                                    member.provider_model_id === model.id
                                )
                            )
                            .map((group) => (
                              <SelectItem key={group.id} value={group.id}>
                                {group.name}
                                {!group.is_enabled && " (disabled)"}
                              </SelectItem>
                            ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </>
          )}
          {step === 3 && (
            <>
              <p role="status">
                Rates and group assignments saved for {selected.length} models.
              </p>
              {selected.map((model) => {
                const state = rates[model.id]
                return (
                  <div
                    key={model.id}
                    className="flex flex-col gap-1 rounded-lg border p-3"
                  >
                    <p className="font-medium break-all">{model.model_name}</p>
                    <p className="text-sm">
                      {state?.kind === "loaded"
                        ? state.rate.tokens_per_credit
                        : "—"}{" "}
                      tokens per credit
                    </p>
                    <p className="text-sm break-all">
                      Groups:{" "}
                      {memberships(model.id)
                        .map(
                          (group) =>
                            `${group.name} (${group.model_id})${group.is_enabled ? "" : " — disabled"}`
                        )
                        .join(", ")}
                    </p>
                  </div>
                )
              })}
              <p className="text-sm text-muted-foreground">
                Requests require an enabled provider and group, sufficient
                provider credits, and sufficient credits on the user making the
                request.
              </p>
            </>
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          {step > 0 && (
            <Button variant="outline" onClick={() => goTo(step - 1)}>
              Back
            </Button>
          )}
          {step < 3 ? (
            <Button disabled={!canContinue} onClick={() => goTo(step + 1)}>
              Continue to {steps[step + 1].toLowerCase()}
            </Button>
          ) : (
            <Button disabled={!canContinue} onClick={onExit}>
              Finish setup
            </Button>
          )}
          <Button variant="ghost" onClick={onExit}>
            Finish later
          </Button>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Provider funding</CardTitle>
          <CardDescription>
            Funding does not block saving configuration.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {balanceError ? (
            <>
              <p role="alert" className="text-destructive">
                {balanceError}
              </p>
              <Button
                variant="outline"
                onClick={() => setBalanceTick((tick) => tick + 1)}
              >
                Retry loading balance
              </Button>
            </>
          ) : balance ? (
            <>
              <p>
                Available: {formatCredits(balance.available_credits)} credits
              </p>
              {isZeroCredits(balance.available_credits) && (
                <p>This provider needs credits before it can fund inference.</p>
              )}
            </>
          ) : (
            <p role="status">Loading balance…</p>
          )}
        </CardContent>
        <CardFooter>
          <Button
            variant="outline"
            disabled={!balance || balanceError !== null}
            onClick={() => setDrawer({ kind: "fund" })}
          >
            Add credits
          </Button>
        </CardFooter>
      </Card>
      {drawer?.kind === "rate" && (
        <ModelRateDrawer
          key={drawer.model.id}
          model={drawer.model}
          onClose={() => setDrawer(null)}
          onSaved={(rate) => {
            rateRevisions.current[rate.provider_model_id] =
              (rateRevisions.current[rate.provider_model_id] ?? 0) + 1
            setRates((current) => ({
              ...current,
              [rate.provider_model_id]: { kind: "loaded", rate },
            }))
            setDrawer(null)
          }}
        />
      )}
      {drawer?.kind === "create" && (
        <ModelGroupFormDrawer
          open
          group={null}
          initialModel={drawer.model}
          onClose={() => setDrawer(null)}
          onSaved={savedGroup}
        />
      )}
      {drawer?.kind === "member" && (
        <ModelGroupMemberFormDrawer
          open
          groupId={drawer.group.id}
          initialModel={drawer.model}
          member={
            drawer.group.members.find(
              (member) => member.provider_model_id === drawer.model.id
            ) ?? null
          }
          onClose={() => setDrawer(null)}
          onSaved={savedGroup}
        />
      )}
      {drawer?.kind === "fund" && (
        <CreditFundingDrawer
          target={{ kind: "provider", id: provider.id, name: provider.name }}
          balance={balance}
          onClose={() => setDrawer(null)}
          onFunded={() => {
            setDrawer(null)
            setBalanceTick((tick) => tick + 1)
          }}
        />
      )}
    </div>
  )
}
