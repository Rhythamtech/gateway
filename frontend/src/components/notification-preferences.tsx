import * as React from "react"
import {
  getNotificationSettings,
  saveNotificationSettings,
  type NotificationSettings,
} from "@/lib/auth"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "sonner"
export function NotificationPreferences() {
  const [data, setData] = React.useState<NotificationSettings | null>(null)
  const [error, setError] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [revision, refresh] = React.useReducer((n: number) => n + 1, 0)
  React.useEffect(() => {
    let stopped = false
    getNotificationSettings()
      .then((value) => {
        if (!stopped) {
          setData(value)
          setError("")
        }
      })
      .catch(() => {
        if (!stopped) setError("Could not load preferences.")
      })
    return () => {
      stopped = true
    }
  }, [revision])
  async function save(event: React.SubmitEvent) {
    event.preventDefault()
    if (!data) return
    setBusy(true)
    try {
      setData(await saveNotificationSettings(data))
      setError("")
      window.dispatchEvent(new Event("gateway:notifications"))
      toast.success("Notification preferences saved")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save preferences")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="outline">Notification preferences</Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Card>
          <CardHeader>
            <CardTitle>Preferences</CardTitle>
            <CardDescription>
              Credit receipts remain in your inbox. Balance warnings remain
              visible while action is needed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <p role="alert">
                {error}
                <Button variant="link" onClick={refresh}>
                  Retry
                </Button>
              </p>
            )}
            {data && (
              <form onSubmit={save}>
                <FieldGroup>
                  <Field orientation="horizontal">
                    <Checkbox
                      id="notify-low-credit"
                      checked={data.low_credit_enabled}
                      onCheckedChange={(v) =>
                        setData({ ...data, low_credit_enabled: v === true })
                      }
                    />
                    <FieldLabel htmlFor="notify-low-credit">
                      Low-credit inbox alerts
                    </FieldLabel>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="notify-threshold">
                      Warn below (credits)
                    </FieldLabel>
                    <Input
                      id="notify-threshold"
                      inputMode="decimal"
                      required
                      value={data.low_credit_threshold}
                      onChange={(e) =>
                        setData({
                          ...data,
                          low_credit_threshold: e.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field orientation="horizontal">
                    <Checkbox
                      id="notify-key-expiry"
                      checked={data.key_expiry_enabled}
                      onCheckedChange={(v) =>
                        setData({ ...data, key_expiry_enabled: v === true })
                      }
                    />
                    <FieldLabel htmlFor="notify-key-expiry">
                      API-key expiry inbox alerts
                    </FieldLabel>
                  </Field>
                  <Button disabled={busy} type="submit">
                    {busy ? "Saving…" : "Save preferences"}
                  </Button>
                </FieldGroup>
              </form>
            )}
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  )
}
