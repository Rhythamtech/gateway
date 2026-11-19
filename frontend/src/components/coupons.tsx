import * as React from "react"
import { toast } from "sonner"
import {
  createCoupon,
  listCoupons,
  updateCoupon,
  type Coupon,
  type CouponPage,
} from "@/lib/auth"
import { formatCredits } from "@/lib/credits"
import { formatTimestampInDeviceZone, parseApiTimestamp } from "@/lib/datetime"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DateTimePicker } from "@/components/ui/date-time-picker"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@/components/ui/field"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { CouponHistory } from "@/components/coupon-history"
import { Check, Copy, Eye } from "lucide-react"

function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Request failed. Please retry."
}
function dateLabel(value: string | null | undefined) {
  if (!value) return "—"
  const date = parseApiTimestamp(value)
  return date === null ? value : formatTimestampInDeviceZone(date)
}
function availability(coupon: Coupon) {
  if (!coupon.enabled) return "Disabled"
  const start = parseApiTimestamp(coupon.starts_at)
  if (start && start.getTime() > Date.now()) return "Scheduled"
  const expiry = parseApiTimestamp(coupon.expires_at)
  if (expiry && expiry.getTime() <= Date.now()) return "Expired"
  if (
    coupon.max_redemptions !== null &&
    coupon.redemption_count >= coupon.max_redemptions
  )
    return "Exhausted"
  return "Available"
}

function CouponStatusBadge({ status }: { status: string }) {
  const variant =
    status === "Available"
      ? "secondary"
      : status === "Expired" || status === "Exhausted"
        ? "destructive"
        : "outline"
  return (
    <Badge variant={variant} className="capitalize text-xs font-medium">
      {status}
    </Badge>
  )
}

function CopyButton({
  value,
  label = "Copy",
}: {
  value: string
  label?: string
}) {
  const [copied, setCopied] = React.useState(false)
  React.useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1800)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground"
      aria-label={label}
      onClick={async (e) => {
        e.stopPropagation()
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
        } catch {
          toast.error("Unable to copy. Select and copy the text instead.")
        }
      }}
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Copy className="size-3.5" />
      )}
    </Button>
  )
}

function CouponOverviewSheet({
  coupon,
  onClose,
  onUpdate,
  revision,
}: {
  coupon: Coupon | null
  onClose: () => void
  onUpdate: () => void
  revision: number
}) {
  const [saving, setSaving] = React.useState(false)
  const [current, setCurrent] = React.useState<Coupon | null>(coupon)

  React.useEffect(() => {
    setCurrent(coupon)
  }, [coupon])

  if (!current) return null

  async function handleSaveName(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!current || saving) return
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim()
    if (!name) return
    setSaving(true)
    try {
      const updated = await updateCoupon(current.id, { name })
      setCurrent(updated)
      onUpdate()
      toast.success("Coupon name updated")
    } catch (error) {
      toast.error(message(error))
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle() {
    if (!current || saving) return
    setSaving(true)
    try {
      const updated = await updateCoupon(current.id, {
        enabled: !current.enabled,
      })
      setCurrent(updated)
      onUpdate()
      toast.success(updated.enabled ? "Coupon enabled" : "Coupon disabled")
    } catch (error) {
      toast.error(message(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open={coupon !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl md:max-w-3xl lg:max-w-4xl p-0 flex flex-col gap-0 overflow-hidden"
      >
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle className="text-base font-semibold">
            Coupon Overview
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            Inspect coupon details, update settings, and review redemptions.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Header block with status & code */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CouponStatusBadge status={availability(current)} />
                <span className="text-xs text-muted-foreground font-mono">
                  {dateLabel(current.created_at)}
                </span>
              </div>
              <Button
                variant={current.enabled ? "outline" : "default"}
                size="sm"
                disabled={saving}
                onClick={handleToggle}
              >
                {current.enabled ? "Disable coupon" : "Enable coupon"}
              </Button>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-bold font-mono tracking-tight text-foreground">
                  {current.code}
                </h2>
                <CopyButton value={current.code} label="Copy coupon code" />
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{current.name}</p>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                <span>ID: {current.id}</span>
                <CopyButton value={current.id} label="Copy coupon ID" />
              </div>
            </div>
          </div>

          {/* 4 Metric cards matching Tracer overview cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border bg-muted/20 p-3.5">
              <p className="text-xs font-medium text-muted-foreground">Credits</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-foreground">
                {formatCredits(current.credits)}
              </p>
              <p className="text-[11px] text-muted-foreground">Per redemption</p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3.5">
              <p className="text-xs font-medium text-muted-foreground">Redemptions</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-foreground">
                {current.redemption_count}
              </p>
              <p className="text-[11px] text-muted-foreground tabular-nums">
                Limit: {current.max_redemptions ?? "Unlimited"}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3.5">
              <p className="text-xs font-medium text-muted-foreground">
                Per-user limit
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums text-foreground">
                {current.per_user_limit}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3.5">
              <p className="text-xs font-medium text-muted-foreground">Expires</p>
              <p className="mt-1 text-xs font-mono font-medium text-foreground">
                {dateLabel(current.expires_at)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Starts: {dateLabel(current.starts_at)}
              </p>
            </div>
          </div>

          {/* Tabs: Redemptions | Settings | Metadata */}
          <Tabs defaultValue="redemptions" className="min-w-0">
            <TabsList className="w-full justify-start border-b rounded-none p-0 bg-transparent h-10 gap-4">
              <TabsTrigger
                value="redemptions"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3 pb-2 text-xs font-medium"
              >
                Redemptions ({current.redemption_count})
              </TabsTrigger>
              <TabsTrigger
                value="settings"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3 pb-2 text-xs font-medium"
              >
                Settings
              </TabsTrigger>
              <TabsTrigger
                value="metadata"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-3 pb-2 text-xs font-medium"
              >
                Metadata
              </TabsTrigger>
            </TabsList>

            <TabsContent value="redemptions" className="mt-4">
              <CouponHistory
                couponId={current.id}
                revision={revision}
              />
            </TabsContent>

            <TabsContent value="settings" className="mt-4 space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Edit coupon name</CardTitle>
                  <CardDescription>
                    Credit amounts, codes and limits are fixed at creation.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    key={`${current.id}-${current.updated_at}`}
                    onSubmit={handleSaveName}
                  >
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="coupon-sheet-name">Name</FieldLabel>
                        <Input
                          id="coupon-sheet-name"
                          name="name"
                          defaultValue={current.name}
                          required
                          maxLength={150}
                          disabled={saving}
                        />
                      </Field>
                      <Field>
                        <Button type="submit" size="sm" disabled={saving}>
                          {saving ? "Saving…" : "Save name"}
                        </Button>
                      </Field>
                    </FieldGroup>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="metadata" className="mt-4">
              <div className="rounded-lg border bg-card p-4">
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground font-medium">Coupon ID</dt>
                    <dd className="font-mono mt-0.5 break-all">{current.id}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground font-medium">Created by</dt>
                    <dd className="font-mono mt-0.5 break-all">{current.created_by}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground font-medium">Starts at</dt>
                    <dd className="font-mono mt-0.5">{dateLabel(current.starts_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground font-medium">Expires at</dt>
                    <dd className="font-mono mt-0.5">{dateLabel(current.expires_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground font-medium">Created at</dt>
                    <dd className="font-mono mt-0.5">{dateLabel(current.created_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground font-medium">Updated at</dt>
                    <dd className="font-mono mt-0.5">{dateLabel(current.updated_at)}</dd>
                  </div>
                </dl>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function CouponsContent() {
  const [page, setPage] = React.useState(1)
  const [revision, setRevision] = React.useState(0)
  const [selected, setSelected] = React.useState<Coupon | null>(null)
  const key = `${page}:${revision}`
  const [result, setResult] = React.useState<{
    key: string
    data?: CouponPage<Coupon>
    error?: string
  } | null>(null)
  const loading = result?.key !== key
  const data = loading ? undefined : result?.data
  const error = loading ? "" : result?.error
  React.useEffect(() => {
    let active = true
    listCoupons(page)
      .then((data) => {
        if (active) setResult({ key, data })
      })
      .catch((error) => {
        if (active) setResult({ key, error: message(error) })
      })
    return () => {
      active = false
    }
  }, [page, key])
  function refresh() {
    setRevision((value) => value + 1)
  }
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h2 className="text-2xl font-semibold">Credit coupons</h2>
      </header>
      <CreateCoupon
        onCreated={() => {
          setPage(1)
          refresh()
        }}
      />
      <Card>
        <CardHeader>
          <CardTitle>Coupons</CardTitle>
          <CardDescription>
            Select a coupon to edit its name or review redemptions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : error ? (
            <p role="alert">{error}</p>
          ) : (
            <Table aria-label="Coupons">
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="min-w-[160px]">Code / name</TableHead>
                  <TableHead className="min-w-[100px]">Credits</TableHead>
                  <TableHead className="min-w-[100px]">Status</TableHead>
                  <TableHead className="min-w-[130px]">Redeemed / limit</TableHead>
                  <TableHead className="min-w-[80px]">Per user</TableHead>
                  <TableHead className="min-w-[150px]">Starts</TableHead>
                  <TableHead className="min-w-[150px]">Expires</TableHead>
                  <TableHead className="text-right min-w-[90px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.length ? (
                  data.items.map((coupon) => (
                    <TableRow
                      key={coupon.id}
                      data-state={selected?.id === coupon.id ? "selected" : undefined}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => setSelected(coupon)}
                    >
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-mono font-medium text-foreground hover:underline">
                            {coupon.code}
                          </span>
                          <span
                            className="text-xs text-muted-foreground truncate max-w-[200px]"
                            title={coupon.name}
                          >
                            {coupon.name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono tabular-nums font-medium">
                        {formatCredits(coupon.credits)}
                      </TableCell>
                      <TableCell>
                        <CouponStatusBadge status={availability(coupon)} />
                      </TableCell>
                      <TableCell className="tabular-nums font-mono text-xs">
                        {coupon.redemption_count} /{" "}
                        {coupon.max_redemptions ?? "Unlimited"}
                      </TableCell>
                      <TableCell className="tabular-nums font-mono text-xs">
                        {coupon.per_user_limit}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {dateLabel(coupon.starts_at)}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {dateLabel(coupon.expires_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2.5 text-xs gap-1"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelected(coupon)
                          }}
                        >
                          <Eye className="size-3.5" />
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No coupons yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={refresh} disabled={loading}>
            Refresh
          </Button>
          <Button
            variant="outline"
            disabled={loading || page === 1}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page}
            {data && ` · ${data.total} coupons`}
          </span>
          <Button
            variant="outline"
            disabled={
              loading || !!error || !data || page * data.page_size >= data.total
            }
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </Button>
        </CardFooter>
      </Card>
      <CouponOverviewSheet
        coupon={selected}
        onClose={() => setSelected(null)}
        onUpdate={() => {
          refresh()
        }}
        revision={revision}
      />
    </div>
  )
}

function CreateCoupon({ onCreated }: { onCreated: () => void }) {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  const [expanded, setExpanded] = React.useState(false)
  const [expiresAt, setExpiresAt] = React.useState<Date | null>(null)

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    const values = new FormData(form)
    const value = (name: string) => String(values.get(name) ?? "").trim()

    const now = new Date()
    if (expiresAt && expiresAt.getTime() <= now.getTime()) {
      setError("Expiry must be after start time")
      return
    }

    setBusy(true)
    setError("")
    try {
      await createCoupon({
        code: value("code"),
        name: value("name"),
        credits: value("credits"),
        enabled: true,
        starts_at: now.toISOString(),
        expires_at: expiresAt ? expiresAt.toISOString() : null,
        max_redemptions: value("max_redemptions")
          ? Number(value("max_redemptions"))
          : null,
        per_user_limit: Number(value("per_user_limit")),
      })
      form.reset()
      setExpiresAt(null)
      onCreated()
      toast.success("Coupon created")
    } catch (error) {
      setError(message(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create a coupon</CardTitle>
        <CardDescription>
          Each redemption grants the specified credits to one user.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="outline"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Close form" : "New coupon"}
        </Button>
        {expanded && (
          <form onSubmit={submit} className="mt-6">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="new-coupon-code">Code</FieldLabel>
                <Input
                  id="new-coupon-code"
                  name="code"
                  required
                  minLength={3}
                  maxLength={64}
                  pattern="[A-Za-z0-9_\-]+"
                  disabled={busy}
                />
                <FieldDescription>
                  3–64 letters, digits, hyphens or underscores.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="new-coupon-name">Name</FieldLabel>
                <Input
                  id="new-coupon-name"
                  name="name"
                  required
                  maxLength={150}
                  disabled={busy}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-coupon-credits">
                  Credits per redemption
                </FieldLabel>
                <Input
                  id="new-coupon-credits"
                  name="credits"
                  required
                  inputMode="decimal"
                  pattern="[0-9]+(\.[0-9]{1,6})?"
                  disabled={busy}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-coupon-max">
                  Global redemption limit
                </FieldLabel>
                <Input
                  id="new-coupon-max"
                  name="max_redemptions"
                  type="number"
                  min={1}
                  max={2147483647}
                  step={1}
                  disabled={busy}
                />
                <FieldDescription>
                  Leave blank for unlimited redemptions.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="new-coupon-per-user">
                  Redemptions per user
                </FieldLabel>
                <Input
                  id="new-coupon-per-user"
                  name="per_user_limit"
                  type="number"
                  required
                  min={1}
                  max={2147483647}
                  step={1}
                  defaultValue={1}
                  disabled={busy}
                />
              </Field>
              <Field>
                <FieldLabel>Starts at</FieldLabel>
                <div className="flex h-9 w-full items-center rounded-md border border-input bg-muted/40 px-3 py-1 text-sm text-muted-foreground select-none">
                  Current time (immediate upon creation)
                </div>
                <FieldDescription>
                  Coupons become active immediately upon creation.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="new-coupon-expiry">
                  Expires at (optional)
                </FieldLabel>
                <DateTimePicker
                  id="new-coupon-expiry"
                  value={expiresAt}
                  onChange={setExpiresAt}
                  disabled={busy}
                  minDate={new Date()}
                  placeholder="Select expiration date & time"
                />
                <FieldDescription>
                  Leave blank for no expiration. If specified, must be after the
                  current time.
                </FieldDescription>
              </Field>
              {error && <FieldError role="alert">{error}</FieldError>}
              <Field>
                <Button type="submit" disabled={busy}>
                  {busy ? "Creating…" : "Create coupon"}
                </Button>
              </Field>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
