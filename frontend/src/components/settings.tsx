import * as React from "react"
import { ArrowUpRight, UserRound } from "lucide-react"
import { toast } from "sonner"

import {
  cacheUser,
  getLogRetention,
  getSignupSettings,
  updateSignupSettings,
  updateLogRetention,
  updateMyPreferences,
  type CurrentUser,
  type LogRetention,
} from "@/lib/auth"
import { useTheme, useThemeStyle } from "@/hooks/use-theme"
import type { Theme, ThemeStyle } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

function PreferenceRow({
  title,
  description,
  checked,
  disabled,
  onToggle,
}: {
  title: string
  description: string
  checked: boolean
  disabled: boolean
  onToggle: () => void
}) {
  const id = React.useId()

  return (
    <div className="flex min-w-0 items-start justify-between gap-4 px-4 py-4 sm:px-5">
      <div className="min-w-0">
        <p id={id} className="text-sm font-medium">
          {title}
        </p>
        <p
          id={`${id}-description`}
          className="mt-1 text-sm leading-5 text-muted-foreground"
        >
          {description}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        aria-describedby={`${id}-description`}
        disabled={disabled}
        onClick={onToggle}
        className={cn(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50",
          checked ? "bg-primary" : "bg-input"
        )}
      >
        <span
          className={cn(
            "pointer-events-none absolute left-0.5 size-4 rounded-full bg-background shadow-sm motion-safe:transition-transform",
            checked && "translate-x-4"
          )}
        />
      </button>
    </div>
  )
}

export function SettingsContent({ user }: { user: CurrentUser }) {
  const { theme, setTheme } = useTheme()
  const { themeStyle, setThemeStyle } = useThemeStyle()
  const [profile, setProfile] = React.useState(user)
  const [tracing, setTracing] = React.useState(user.tracing_enabled)
  const [telemetry, setTelemetry] = React.useState(user.telemetry_enabled)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [retention, setRetention] = React.useState<LogRetention>("never")
  const [retentionDraft, setRetentionDraft] =
    React.useState<LogRetention>("never")
  const [retentionSaving, setRetentionSaving] = React.useState(false)
  const [retentionLoaded, setRetentionLoaded] = React.useState(false)
  const [retentionError, setRetentionError] = React.useState<string | null>(
    null
  )
  const [retentionRetry, setRetentionRetry] = React.useState(0)
  const [signupsEnabled, setSignupsEnabled] = React.useState<boolean | null>(
    null
  )
  const [signupsSaving, setSignupsSaving] = React.useState(false)
  const [signupsError, setSignupsError] = React.useState<string | null>(null)
  const [signupsRetry, setSignupsRetry] = React.useState(0)
  React.useEffect(() => {
    if (user.role !== "superuser") return
    let active = true
    getSignupSettings()
      .then((result) => {
        if (active) {
          setSignupsEnabled(result.signups_enabled)
          setSignupsError(null)
        }
      })
      .catch((reason: unknown) => {
        if (active)
          setSignupsError(
            reason instanceof Error
              ? reason.message
              : "Unable to load signup settings."
          )
      })
    return () => {
      active = false
    }
  }, [user.role, signupsRetry])

  async function toggleSignups() {
    if (signupsEnabled === null || signupsSaving) return
    setSignupsSaving(true)
    try {
      const result = await updateSignupSettings(!signupsEnabled)
      setSignupsEnabled(result.signups_enabled)
      toast.success(
        result.signups_enabled
          ? "New signups enabled."
          : "New signups disabled."
      )
    } catch (reason) {
      toast.error(
        reason instanceof Error
          ? reason.message
          : "Unable to update signup settings."
      )
    } finally {
      setSignupsSaving(false)
    }
  }

  const tracingChanged = tracing !== profile.tracing_enabled
  const telemetryChanged = telemetry !== profile.telemetry_enabled
  const dirty = tracingChanged || telemetryChanged
  React.useEffect(() => {
    if (user.role !== "superuser") return
    let active = true
    getLogRetention()
      .then(({ log_retention }) => {
        if (!active) return
        setRetention(log_retention)
        setRetentionDraft(log_retention)
        setRetentionLoaded(true)
        setRetentionError(null)
      })
      .catch((reason: unknown) => {
        if (active)
          setRetentionError(
            reason instanceof Error
              ? reason.message
              : "Unable to load the retention policy."
          )
      })
    return () => {
      active = false
    }
  }, [user.role, retentionRetry])

  async function saveRetention() {
    setRetentionSaving(true)
    try {
      const result = await updateLogRetention(retentionDraft)
      setRetention(result.log_retention)
      setRetentionDraft(result.log_retention)
      toast.success("Log retention policy saved.")
    } catch (reason) {
      toast.error(
        reason instanceof Error
          ? reason.message
          : "Unable to save log retention."
      )
    } finally {
      setRetentionSaving(false)
    }
  }

  function discardChanges() {
    setTracing(profile.tracing_enabled)
    setTelemetry(profile.telemetry_enabled)
    setError(null)
  }

  async function savePreferences(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dirty || saving) return
    setSaving(true)
    setError(null)
    try {
      const updated = await updateMyPreferences({
        tracingEnabled: tracingChanged ? tracing : undefined,
        telemetryEnabled: telemetryChanged ? telemetry : undefined,
      })
      cacheUser(updated)
      setProfile(updated)
      setTracing(updated.tracing_enabled)
      setTelemetry(updated.telemetry_enabled)
      toast.success("Observability preferences saved.")
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to save your preferences."
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="@container/settings flex w-full max-w-4xl min-w-0 flex-col gap-7">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">
          Account settings
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Manage your account preferences and how Gateway records your traffic.
        </p>
      </header>

      <section
        aria-labelledby="settings-account"
        className="grid min-w-0 gap-4 @min-[680px]/settings:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
      >
        <div>
          <h3 id="settings-account" className="text-sm font-semibold">
            Account
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Your signed-in identity and API access.
          </p>
        </div>
        <div className="min-w-0 divide-y rounded-xl border bg-card">
          <div className="flex min-w-0 items-center gap-3 p-4 sm:px-5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <UserRound className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Signed in as</p>
              <p className="text-sm font-medium break-all">{profile.email}</p>
            </div>
            <Badge variant="secondary" className="ml-auto shrink-0">
              {profile.role === "superuser" ? "Superuser" : "User"}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 p-4 sm:px-5">
            <p className="text-sm font-medium">API keys</p>
            <Button asChild variant="outline" size="sm">
              <a href="/dashboard/api-keys">
                Manage keys <ArrowUpRight data-icon="inline-end" />
              </a>
            </Button>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="settings-appearance"
        className="grid min-w-0 gap-4 border-t pt-6 @min-[680px]/settings:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
      >
        <div>
          <h3 id="settings-appearance" className="text-sm font-semibold">
            Appearance
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Personalize the dashboard on this browser.
          </p>
        </div>
        <div className="min-w-0 divide-y rounded-xl border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:px-5">
            <div>
              <label htmlFor="settings-theme" className="text-sm font-medium">
                Theme
              </label>
              <p className="mt-1 text-sm text-muted-foreground">
                Light, dark, or follow the system.
              </p>
            </div>
            <Select
              value={theme}
              onValueChange={(value) => setTheme(value as Theme)}
            >
              <SelectTrigger id="settings-theme" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="system">System</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:px-5">
            <div>
              <label
                htmlFor="settings-theme-style"
                className="text-sm font-medium"
              >
                Theme style
              </label>
              <p className="mt-1 text-sm text-muted-foreground">
                Color palette for the interface.
              </p>
            </div>
            <Select
              value={themeStyle}
              onValueChange={(value) => setThemeStyle(value as ThemeStyle)}
            >
              <SelectTrigger id="settings-theme-style" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="classic">Classic</SelectItem>
                  <SelectItem value="endless-blue">Endless Blue</SelectItem>
                  <SelectItem value="fresh-green">Fresh Green</SelectItem>
                  <SelectItem value="ember">Ember</SelectItem>
                  <SelectItem value="devlog">DevLog</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="settings-observability"
        className="grid min-w-0 gap-4 border-t pt-6 @min-[680px]/settings:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
      >
        <div>
          <h3 id="settings-observability" className="text-sm font-semibold">
            Observability
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose what Gateway records or exports for your future requests.
          </p>
        </div>
        <form
          onSubmit={savePreferences}
          className="min-w-0 divide-y rounded-xl border bg-card"
        >
          <PreferenceRow
            title="Request tracing"
            description="Store request traces and usage metrics for your traffic. Turning this off stops new recordings."
            checked={tracing}
            disabled={saving}
            onToggle={() => setTracing((value) => !value)}
          />
          <PreferenceRow
            title="OpenTelemetry export"
            description="Allow operational spans for your traffic to be sent to the gateway’s configured telemetry collector."
            checked={telemetry}
            disabled={saving}
            onToggle={() => setTelemetry((value) => !value)}
          />
          <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p role="status" className="text-xs text-muted-foreground">
                {saving
                  ? "Saving preferences…"
                  : dirty
                    ? "Unsaved changes"
                    : "Preferences saved"}
              </p>
              <div className="flex flex-wrap gap-2">
                {dirty && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={saving}
                    onClick={discardChanges}
                  >
                    Discard
                  </Button>
                )}
                <Button type="submit" size="sm" disabled={!dirty || saving}>
                  Save changes
                </Button>
              </div>
            </div>
          </div>
        </form>
      </section>
      {profile.role === "superuser" && (
        <section
          aria-labelledby="settings-signups"
          className="grid min-w-0 gap-4 border-t pt-6 @min-[680px]/settings:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
        >
          <div>
            <h3 id="settings-signups" className="text-sm font-semibold">
              Registration
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Control access for new accounts.
            </p>
          </div>
          <div className="rounded-xl border bg-card">
            <PreferenceRow
              title="Allow new signups"
              description="When disabled, existing users can still sign in."
              checked={signupsEnabled ?? false}
              disabled={signupsEnabled === null || signupsSaving}
              onToggle={() => void toggleSignups()}
            />
            {signupsError && (
              <div
                role="alert"
                className="flex items-center gap-2 px-4 pb-4 text-sm text-destructive"
              >
                <p>{signupsError}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSignupsError(null)
                    setSignupsRetry((value) => value + 1)
                  }}
                >
                  Try again
                </Button>
              </div>
            )}
          </div>
        </section>
      )}
      {profile.role === "superuser" && (
        <section
          aria-labelledby="settings-retention"
          className="grid min-w-0 gap-4 border-t pt-6 @min-[680px]/settings:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
        >
          <div>
            <h3 id="settings-retention" className="text-sm font-semibold">
              Data retention
            </h3>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 sm:px-5">
            <label
              htmlFor="settings-retention-policy"
              className="text-sm font-medium"
            >
              Automatic log deletion
            </label>
            <div className="flex items-center gap-2">
              <Select
                disabled={!retentionLoaded || retentionSaving}
                value={retentionDraft}
                onValueChange={(value) =>
                  setRetentionDraft(value as LogRetention)
                }
              >
                <SelectTrigger id="settings-retention-policy" className="w-36">
                  <SelectValue>
                    {retentionLoaded ? undefined : "Loading…"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="never">Never</SelectItem>
                    <SelectItem value="24h">24 hours</SelectItem>
                    <SelectItem value="7d">7 days</SelectItem>
                    <SelectItem value="30d">30 days</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={
                  !retentionLoaded ||
                  retentionDraft === retention ||
                  retentionSaving
                }
                onClick={saveRetention}
              >
                {retentionSaving ? "Saving…" : "Save"}
              </Button>
            </div>
            {retentionError && (
              <div
                role="alert"
                className="flex w-full flex-wrap items-center gap-2 text-sm text-destructive"
              >
                <p>{retentionError}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setRetentionError(null)
                    setRetentionRetry((value) => value + 1)
                  }}
                >
                  Try again
                </Button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
