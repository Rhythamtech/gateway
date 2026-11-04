import * as React from "react"
import { IconCircleCheckFilled, IconBan } from "@tabler/icons-react"

import {
  ApiError,
  cacheUser,
  updateMyPreferences,
  updateUserTracing,
  type CurrentUser,
} from "@/lib/auth"
import { toast } from "sonner"
import { cn } from "cn"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

type PendingField = "tracing" | "telemetry" | null

// Self-contained switch control (no matching primitive exists in ui/); a
// native button keeps keyboard and screen-reader semantics without a new
// dependency.
function ToggleSwitch({
  checked,
  disabled,
  label,
  onToggle,
}: {
  checked: boolean
  disabled: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input dark:bg-input/60"
      )}
    >
      <span
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform",
          checked ? "translate-x-[calc(100%-2px)]" : "translate-x-0"
        )}
      />
    </button>
  )
}

type SettingRowProps = {
  title: string
  description: React.ReactNode
  checked: boolean
  disabled: boolean
  badge?: React.ReactNode
  pending: boolean
  statusLabel: string
  label: string
  onToggle: () => void
}

function SettingRow({
  title,
  description,
  checked,
  disabled,
  badge,
  pending,
  statusLabel,
  label,
  onToggle,
}: SettingRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{title}</p>
          {badge}
        </div>
        <div className="max-w-prose text-xs text-muted-foreground">
          {description}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <ToggleSwitch
          checked={checked}
          disabled={disabled}
          label={label}
          onToggle={onToggle}
        />
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {pending ? "Saving…" : statusLabel}
        </span>
      </div>
    </div>
  )
}

function OnOffBadge({ on }: { on: boolean }) {
  if (on) {
    return (
      <Badge variant="outline" className="gap-1 px-1.5 text-xs">
        <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
        On
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 px-1.5 text-xs text-muted-foreground"
    >
      <IconBan className="size-3" />
      Off
    </Badge>
  )
}

export function SettingsContent({ user }: { user: CurrentUser }) {
  // Local profile starts from the AuthGate-validated user and is refreshed
  // after each successful toggle; cacheUser keeps instant paints on other
  // pages consistent until their next /users/me revalidation.
  const [profile, setProfile] = React.useState<CurrentUser>(user)
  const [pending, setPending] = React.useState<PendingField>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)

  const isSuperuser = profile.role === "superuser"

  async function toggleTelemetry() {
    if (profile.telemetry_enabled === undefined) return
    setPending("telemetry")
    setActionError(null)

    try {
      const updated = await updateMyPreferences(!profile.telemetry_enabled)
      setProfile(updated)
      cacheUser(updated)
      toast.success(
        updated.telemetry_enabled
          ? "OpenTelemetry spans enabled for your traffic."
          : "OpenTelemetry spans disabled for your traffic."
      )
    } catch (error) {
      setActionError(
        error instanceof ApiError
          ? error.message
          : "Unable to update your telemetry preference."
      )
    } finally {
      setPending(null)
    }
  }

  async function toggleTracing() {
    if (!isSuperuser) return
    setPending("tracing")
    setActionError(null)

    try {
      const updated = await updateUserTracing(
        profile.id,
        !profile.tracing_enabled
      )
      setProfile(updated)
      cacheUser(updated)
      toast.success(
        updated.tracing_enabled
          ? "Usage tracing enabled — recorded requests will appear in LLM Traces."
          : "Usage tracing disabled — no new trace rows will be recorded."
      )
    } catch (error) {
      setActionError(
        error instanceof ApiError
          ? error.message
          : "Unable to update usage tracing."
      )
    } finally {
      setPending(null)
    }
  }

  return (
    <>
      <div className="flex flex-col items-start justify-between gap-2 px-4 lg:flex-row lg:items-center lg:px-6">
        <p className="text-sm text-muted-foreground">
          Observability controls for your own API traffic. Turning these off
          never blocks inference; it only stops what gets recorded or exported.
        </p>
      </div>
      <div className="px-4 lg:px-6">
        {actionError !== null ? (
          <p className="mb-2 text-sm text-destructive" role="alert">
            {actionError}
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Observability</CardTitle>
              <CardDescription>
                Trace recording feeds the LLM Traces pages. OpenTelemetry spans
                feed operational trace exporters and are emitted only when the
                server&rsquo;s telemetry exporter is enabled as well.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col">
              <SettingRow
                title="Usage tracing"
                description={
                  <span>
                    Persist your requests and provider call attempts to{" "}
                    <span className="font-mono text-[11px]">/traces</span>. When
                    off, no trace rows or usage aggregates are recorded for your
                    traffic.
                    {isSuperuser ? null : " Managed by a superuser."}
                  </span>
                }
                badge={
                  <>
                    <OnOffBadge on={profile.tracing_enabled} />
                    {isSuperuser ? null : (
                      <Badge
                        variant="secondary"
                        className="px-1.5 text-[11px] text-muted-foreground"
                      >
                        Superuser-managed
                      </Badge>
                    )}
                  </>
                }
                checked={profile.tracing_enabled}
                disabled={!isSuperuser || pending !== null}
                pending={pending === "tracing"}
                statusLabel={
                  profile.tracing_enabled
                    ? "Requests are recorded"
                    : "Requests are not recorded"
                }
                label="Toggle usage tracing"
                onToggle={toggleTracing}
              />
              <Separator />
              <SettingRow
                title="OpenTelemetry spans"
                description={
                  <span>
                    Export OpenTelemetry spans for gateway and provider attempts
                    from your traffic. This is an operational telemetry opt-out,
                    independent of trace recording.
                  </span>
                }
                badge={<OnOffBadge on={profile.telemetry_enabled} />}
                checked={profile.telemetry_enabled}
                disabled={pending !== null}
                pending={pending === "telemetry"}
                statusLabel={
                  profile.telemetry_enabled
                    ? "Spans are exported"
                    : "Spans are not exported"
                }
                label="Toggle OpenTelemetry spans"
                onToggle={toggleTelemetry}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
