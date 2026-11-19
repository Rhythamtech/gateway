import * as React from "react"
import { toast } from "sonner"
import { redeemCoupon } from "@/lib/auth"
import { formatCredits } from "@/lib/credits"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
} from "@/components/ui/field"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { CouponHistory } from "@/components/coupon-history"

export function CouponRedeem({ onRedeemed }: { onRedeemed: () => void }) {
  const [code, setCode] = React.useState(
    () => new URLSearchParams(window.location.search).get("coupon") ?? ""
  )
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState("")
  const [revision, setRevision] = React.useState(0)
  const attempt = React.useRef<{ code: string; key: string } | null>(null)
  async function submit(event: React.SubmitEvent) {
    event.preventDefault()
    if (busy) return
    const normalized = code.trim().toUpperCase()
    if (attempt.current?.code !== normalized)
      attempt.current = { code: normalized, key: crypto.randomUUID() }
    setBusy(true)
    setError("")
    try {
      const receipt = await redeemCoupon(normalized, attempt.current.key)
      attempt.current = null
      setCode("")
      setRevision((value) => value + 1)
      onRedeemed()
      window.dispatchEvent(new Event("gateway:notifications"))
      window.dispatchEvent(new Event("gateway:announcements"))
      toast.success(`${formatCredits(receipt.credits)} credits added`)
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not redeem coupon. Retry to check the same request."
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Redeem a coupon</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field data-invalid={!!error}>
                <FieldLabel htmlFor="coupon-code">Coupon code</FieldLabel>
                <Input
                  id="coupon-code"
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value)
                    setError("")
                  }}
                  required
                  minLength={3}
                  maxLength={64}
                  pattern="[A-Za-z0-9_\-]+"
                  autoCapitalize="characters"
                  autoComplete="off"
                  disabled={busy}
                  aria-invalid={!!error}
                  aria-describedby={error ? "coupon-error" : undefined}
                />
                {error && (
                  <FieldError id="coupon-error" role="alert">
                    {error}
                  </FieldError>
                )}
              </Field>
              <Field>
                <Button type="submit" disabled={busy}>
                  {busy ? "Redeeming…" : "Redeem credits"}
                </Button>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      <CouponHistory revision={revision} />
    </div>
  )
}
