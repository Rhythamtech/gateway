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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { Skeleton } from "@/components/ui/skeleton"
import { CouponHistory } from "@/components/coupon-history"

function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Request failed. Please retry."
}
function dateLabel(value: string | null) {
  if (!value) return "—"
  return formatTimestampInDeviceZone(
    parseApiTimestamp(value) ?? new Date(value)
  )
}
function availability(coupon: Coupon) {
  if (!coupon.enabled) return "Disabled"
  if (coupon.starts_at && Date.parse(coupon.starts_at) > Date.now())
    return "Scheduled"
  if (coupon.expires_at && Date.parse(coupon.expires_at) <= Date.now())
    return "Expired"
  if (
    coupon.max_redemptions !== null &&
    coupon.redemption_count >= coupon.max_redemptions
  )
    return "Exhausted"
  return "Available"
}

export function CouponsContent() {
  const [page, setPage] = React.useState(1)
  const [revision, setRevision] = React.useState(0)
  const [selected, setSelected] = React.useState<Coupon | null>(null)
  const [saving, setSaving] = React.useState(false)
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
  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || saving) return
    const name = String(new FormData(event.currentTarget).get("name"))
    setSaving(true)
    try {
      setSelected(await updateCoupon(selected.id, { name }))
      refresh()
      toast.success("Coupon name updated")
    } catch (error) {
      toast.error(message(error))
    } finally {
      setSaving(false)
    }
  }
  async function toggle(coupon: Coupon) {
    if (saving) return
    setSaving(true)
    try {
      const updated = await updateCoupon(coupon.id, {
        enabled: !coupon.enabled,
      })
      if (selected?.id === updated.id) setSelected(updated)
      refresh()
      toast.success(updated.enabled ? "Coupon enabled" : "Coupon disabled")
    } catch (error) {
      toast.error(message(error))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h2 className="text-2xl font-semibold">Credit coupons</h2>
        <p className="text-sm text-muted-foreground">
          Create fixed-credit offers and track their redemptions.
        </p>
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code / name</TableHead>
                  <TableHead>Credits</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Redeemed / limit</TableHead>
                  <TableHead>Per user</TableHead>
                  <TableHead>Starts</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.length ? (
                  data.items.map((coupon) => (
                    <TableRow key={coupon.id}>
                      <TableCell>
                        <Button
                          variant="link"
                          onClick={() => setSelected(coupon)}
                        >
                          {coupon.code}
                        </Button>
                        <p>{coupon.name}</p>
                      </TableCell>
                      <TableCell>{formatCredits(coupon.credits)}</TableCell>
                      <TableCell>{availability(coupon)}</TableCell>
                      <TableCell>
                        {coupon.redemption_count} /{" "}
                        {coupon.max_redemptions ?? "Unlimited"}
                      </TableCell>
                      <TableCell>{coupon.per_user_limit}</TableCell>
                      <TableCell>{dateLabel(coupon.starts_at)}</TableCell>
                      <TableCell>{dateLabel(coupon.expires_at)}</TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          disabled={saving}
                          onClick={() => toggle(coupon)}
                        >
                          {coupon.enabled ? "Disable" : "Enable"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={8}>No coupons yet.</TableCell>
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
      {selected && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{selected.code}</CardTitle>
              <CardDescription>
                Credit amounts, dates and redemption limits are fixed at
                creation. Disable this code and create another to change its
                terms.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                key={`${selected.id}-${selected.updated_at}`}
                onSubmit={save}
              >
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="coupon-edit-name">Name</FieldLabel>
                    <Input
                      id="coupon-edit-name"
                      name="name"
                      defaultValue={selected.name}
                      required
                      maxLength={150}
                      disabled={saving}
                    />
                  </Field>
                  <Field>
                    <Button type="submit" disabled={saving}>
                      {saving ? "Saving…" : "Save name"}
                    </Button>
                  </Field>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>
          <CouponHistory
            key={selected.id}
            couponId={selected.id}
            revision={revision}
          />
        </>
      )}
    </div>
  )
}

function CreateCoupon({ onCreated }: { onCreated: () => void }) {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  const [expanded, setExpanded] = React.useState(false)
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    const values = new FormData(form)
    const value = (name: string) => String(values.get(name) ?? "").trim()
    const instant = (name: string) =>
      value(name) ? new Date(value(name)).toISOString() : null
    setBusy(true)
    setError("")
    try {
      await createCoupon({
        code: value("code"),
        name: value("name"),
        credits: value("credits"),
        enabled: true,
        starts_at: instant("starts_at"),
        expires_at: instant("expires_at"),
        max_redemptions: value("max_redemptions")
          ? Number(value("max_redemptions"))
          : null,
        per_user_limit: Number(value("per_user_limit")),
      })
      form.reset()
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
                <FieldLabel htmlFor="new-coupon-start">
                  Starts at (your local time)
                </FieldLabel>
                <Input
                  id="new-coupon-start"
                  name="starts_at"
                  type="datetime-local"
                  disabled={busy}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-coupon-expiry">
                  Expires at (your local time)
                </FieldLabel>
                <Input
                  id="new-coupon-expiry"
                  name="expires_at"
                  type="datetime-local"
                  disabled={busy}
                />
                <FieldDescription>
                  Leave dates blank for no time restriction. New coupons are
                  enabled immediately or at their start time.
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
