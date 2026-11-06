import * as React from "react"
import { RefreshCw, X, Layers } from "lucide-react"
import {
  getApiKeyUsage,
  getGatewayModelUsage,
  listModelGroups,
  type ApiKeyItem,
  type CurrentUser,
  type ModelGroup,
  type UsageAnalytics,
} from "@/lib/auth"
import { DashboardMetricTrend } from "@/components/dashboard-metric-trend"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type Subject = { id: string; label: string }
type Kind = "keys" | "models"
type ComparisonRow = Subject & { data?: UsageAnalytics; error?: string }
const MAX_SUBJECTS = 4
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Explicit, bounded comparisons; never enumerate subjects to infer account totals. */
export default function DashboardComparison({
  user,
  keys,
  from,
  to,
  refreshTick,
}: {
  user: CurrentUser
  keys: ApiKeyItem[]
  from: string
  to: string
  refreshTick: number
}) {
  const [kind, setKind] = React.useState<Kind>("keys")
  const [draft, setDraft] = React.useState<Subject[]>([])
  const [applied, setApplied] = React.useState<Subject[]>([])
  const [target, setTarget] = React.useState("")
  const [formError, setFormError] = React.useState<string | null>(null)
  const [catalogPage, setCatalogPage] = React.useState(1)
  const [catalog, setCatalog] = React.useState<{
    page: number
    tick: number
    items: ModelGroup[]
    total: number
    error?: string
  } | null>(null)
  const [retry, setRetry] = React.useState(0)
  const [result, setResult] = React.useState<{
    key: string
    scope: string
    rows: ComparisonRow[]
    at: Date
  } | null>(null)
  const scopeKey = `${kind}:${applied.map((item) => item.id).join(",")}:${from}:${to}`
  const requestKey = `${scopeKey}:${refreshTick}:${retry}`
  const rows = result?.scope === scopeKey ? result.rows : null
  const loading = applied.length > 0 && result?.key !== requestKey
  const catalogReady =
    catalog?.page === catalogPage && catalog.tick === refreshTick + retry
  const options: Subject[] =
    kind === "keys"
      ? keys.map((key) => ({
          id: key.id,
          label: `${key.name || key.key_prefix}${key.revoked ? " (revoked)" : ""}`,
        }))
      : catalogReady
        ? (catalog?.items ?? []).map((model) => ({
            id: model.id,
            label: `${model.name} (${model.model_id})`,
          }))
        : []
  React.useEffect(() => {
    if (kind !== "models") return
    let cancelled = false
    listModelGroups({ page: catalogPage, pageSize: 20 })
      .then((value) => {
        if (!cancelled)
          setCatalog({
            page: catalogPage,
            tick: refreshTick + retry,
            items: value.items,
            total: value.total,
          })
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setCatalog({
            page: catalogPage,
            tick: refreshTick + retry,
            items: [],
            total: 0,
            error:
              error instanceof Error
                ? error.message
                : "Model groups could not be loaded.",
          })
      })
    return () => {
      cancelled = true
    }
  }, [kind, catalogPage, refreshTick, retry])
  React.useEffect(() => {
    if (!applied.length) return
    let cancelled = false
    const load = kind === "keys" ? getApiKeyUsage : getGatewayModelUsage
    void Promise.allSettled(
      applied.map((item) => load(item.id, { from, to }))
    ).then((results) => {
      if (cancelled) return
      const next: ComparisonRow[] = results.map((value, index) =>
        value.status === "fulfilled"
          ? { ...applied[index], data: value.value }
          : {
              ...applied[index],
              error:
                value.reason instanceof Error
                  ? value.reason.message
                  : "Analytics unavailable.",
            }
      )
      setResult({
        key: requestKey,
        scope: scopeKey,
        rows: next,
        at: new Date(),
      })
    })
    return () => {
      cancelled = true
    }
  }, [applied, kind, from, to, requestKey, scopeKey])
  function changeKind(value: string) {
    setKind(value as Kind)
    setDraft([])
    setApplied([])
    setTarget("")
    setFormError(null)
  }
  function addSubject(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    addSelection(target)
  }
  function addSelection(value: string) {
    setFormError(null)
    const id = value.trim().toLowerCase()
    const candidate = options.find((item) => item.id.toLowerCase() === id)
    if (
      !candidate &&
      (kind !== "models" || user.role === "superuser" || !UUID.test(id))
    ) {
      setFormError(
        kind === "models" && user.role !== "superuser"
          ? "Enter a valid gateway model group UUID."
          : "Select a subject to compare."
      )
      return
    }
    if (draft.some((item) => item.id.toLowerCase() === id)) {
      setFormError("This subject is already selected.")
      return
    }
    if (draft.length >= MAX_SUBJECTS) {
      setFormError("Compare up to four subjects at a time.")
      return
    }
    setDraft((current) => [...current, candidate ?? { id, label: id }])
    setTarget("")
  }
  const maxCalls = Math.max(
    1,
    ...(rows ?? []).map((row) => row.data?.totals.call_count ?? 0)
  )
  const changed =
    draft.map((item) => item.id).join(",") !==
    applied.map((item) => item.id).join(",")
  return (
    <section
      className="@container/comparison min-w-0 overflow-hidden rounded-xl border bg-card"
      aria-label="Usage comparison"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b p-4 sm:p-6">
        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            <Layers className="size-4" />
            Selected-subject comparison
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Select up to four subjects, then compare their recorded usage.
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          {from} – {to} · UTC
        </div>
      </div>
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <form onSubmit={addSubject} className="flex flex-wrap items-end gap-3">
          <Field className="w-full gap-2 sm:w-40">
            <FieldLabel htmlFor="compare-kind">Compare by</FieldLabel>
            <Select value={kind} onValueChange={changeKind}>
              <SelectTrigger id="compare-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="keys">API keys</SelectItem>
                  <SelectItem value="models">Model groups</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field
            className="min-w-0 flex-1 basis-56 gap-2"
            data-invalid={Boolean(formError)}
          >
            <FieldLabel htmlFor="compare-subject">
              {kind === "keys" ? "API key" : "Gateway model group"}
            </FieldLabel>
            <Select
              value=""
              onValueChange={addSelection}
              disabled={draft.length >= MAX_SUBJECTS}
            >
              <SelectTrigger
                id="compare-subject"
                className="w-full min-w-0"
                aria-invalid={Boolean(formError)}
                aria-describedby="compare-help compare-error"
              >
                <SelectValue
                  placeholder={
                    kind === "models" && !catalogReady
                      ? "Loading model groups…"
                      : draft.length >= MAX_SUBJECTS
                        ? "Four subjects selected"
                        : "Select to add…"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {options
                    .filter(
                      (item) =>
                        !draft.some((selected) => selected.id === item.id)
                    )
                    .map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.label}
                      </SelectItem>
                    ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </form>
        <p
          id="compare-help"
          className="text-xs leading-5 text-muted-foreground"
        >
          {kind === "keys"
            ? "Own API keys only. Counts include recorded provider attempts, not unique requests."
            : user.role === "superuser"
              ? "Model-group analytics cover all users across the gateway. They are separate from the account scope above."
              : "Model analytics cover only your recorded usage for the selected gateway model groups."}{" "}
          No totals are inferred across subjects.
        </p>
        <p
          id="compare-error"
          role={formError ? "alert" : undefined}
          className={formError ? "text-xs text-destructive" : "sr-only"}
        >
          {formError ?? ""}
        </p>
        {kind === "models" && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {catalogReady && catalog?.error ? (
              <>
                <span role="alert">{catalog.error}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  Retry model list
                </Button>
              </>
            ) : (
              <>
                <span>
                  Model catalog · page {catalogPage}
                  {catalogReady
                    ? ` of ${Math.max(1, Math.ceil((catalog?.total ?? 0) / 20))}`
                    : ""}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={catalogPage <= 1 || !catalogReady}
                  onClick={() => {
                    setTarget("")
                    setCatalogPage((value) => value - 1)
                  }}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={
                    !catalogReady || catalogPage * 20 >= (catalog?.total ?? 0)
                  }
                  onClick={() => {
                    setTarget("")
                    setCatalogPage((value) => value + 1)
                  }}
                >
                  Next
                </Button>
              </>
            )}
          </div>
        )}
        {kind === "keys" && !keys.length && (
          <p className="text-sm text-muted-foreground">
            No API keys are available.{" "}
            <a
              href="/dashboard/api-keys"
              className="underline underline-offset-4"
            >
              Manage API keys
            </a>
          </p>
        )}
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label="Selected comparison subjects"
        >
          {draft.map((item) => (
            <Badge
              key={item.id}
              variant="secondary"
              className="max-w-full gap-1 py-1"
            >
              <span className="max-w-56 truncate" title={item.label}>
                {item.label}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label={`Remove ${item.label}`}
                onClick={() =>
                  setDraft((current) =>
                    current.filter((subject) => subject.id !== item.id)
                  )
                }
              >
                <X />
              </Button>
            </Badge>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={!draft.length || loading}
            onClick={() => {
              setApplied([...draft])
              setRetry((value) => value + 1)
            }}
          >
            {applied.length ? "Update comparison" : "Compare selected"}
            {draft.length ? ` (${draft.length}/4)` : ""}
          </Button>
          {applied.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setApplied([])
                setDraft([])
                setTarget("")
                setFormError(null)
              }}
            >
              Clear comparison
            </Button>
          )}
          <p role="status" className="text-xs text-muted-foreground">
            {loading
              ? "Loading selected subjects…"
              : changed && applied.length
                ? "Selection changed. Update comparison to apply it."
                : rows && result
                  ? `Updated ${result.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : ""}
          </p>
        </div>
      </div>
      {loading && !rows ? (
        <div
          className="flex flex-col gap-3 border-t p-6"
          role="status"
          aria-label="Loading comparison"
        >
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : rows ? (
        <div className="overflow-x-auto border-t" aria-busy={loading}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">
                  Compared {kind === "keys" ? "API key" : "model group"}
                </TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Success rate</TableHead>
                <TableHead className="text-right">Input tokens</TableHead>
                <TableHead className="text-right">Output tokens</TableHead>
                <TableHead className="pr-6 text-right">Avg latency</TableHead>
                <TableHead className="hidden pr-6 @min-[760px]/comparison:table-cell">
                  Daily calls
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-72 min-w-44 py-4 pl-6">
                    <span
                      className="block truncate font-medium"
                      title={row.label}
                    >
                      {row.label}
                    </span>
                    {row.data && (
                      <div
                        className="mt-2 h-1.5 w-full rounded-full bg-muted"
                        aria-label={`${row.data.totals.call_count.toLocaleString()} calls relative to the largest selected subject`}
                      >
                        <div
                          className="h-full rounded-full bg-primary/60"
                          style={{
                            width: `${(row.data.totals.call_count / maxCalls) * 100}%`,
                          }}
                        />
                      </div>
                    )}
                  </TableCell>
                  {row.error ? (
                    <TableCell colSpan={6} className="pr-6">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span role="alert" className="text-xs text-destructive">
                          {row.error}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setRetry((value) => value + 1)}
                        >
                          <RefreshCw data-icon="inline-start" />
                          Retry
                        </Button>
                      </div>
                    </TableCell>
                  ) : row.data ? (
                    <>
                      <TableCell className="text-right tabular-nums">
                        {row.data.totals.call_count.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.data.totals.call_count
                          ? `${((row.data.totals.successful_call_count / row.data.totals.call_count) * 100).toFixed(1)}%`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.data.totals.input_tokens.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.data.totals.output_tokens.toLocaleString()}
                      </TableCell>
                      <TableCell className="pr-6 text-right tabular-nums">
                        {row.data.totals.average_latency_ms == null
                          ? "—"
                          : `${(row.data.totals.average_latency_ms / 1000).toFixed(2)} s`}
                      </TableCell>
                      <TableCell className="hidden w-28 pr-6 @min-[760px]/comparison:table-cell">
                        <DashboardMetricTrend
                          values={row.data.daily.map((day) => day.call_count)}
                          color="var(--analytics-volume)"
                        />
                        <span className="sr-only">
                          Daily call series:{" "}
                          {row.data.daily
                            .map((day) => `${day.date}: ${day.call_count}`)
                            .join("; ")}
                        </span>
                      </TableCell>
                    </>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="px-6 py-3 text-xs text-muted-foreground">
            Bars compare call counts to the largest selected subject. Missing
            provider usage is not estimated. Zero calls have no success rate.
          </p>
        </div>
      ) : (
        <p className="border-t px-6 py-5 text-xs text-muted-foreground">
          Select subjects above to build a comparison. Nothing is loaded until
          you choose Compare selected.
        </p>
      )}
    </section>
  )
}
