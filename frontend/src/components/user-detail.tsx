import * as React from "react"
import { ArrowLeft, RefreshCw } from "lucide-react"

import {
  getUserAdminAudit,
  getUserCredits,
  getUserUsage,
  listUserCreditHistory,
  listUsers,
  type CurrentUser,
} from "@/lib/auth"
import { formatCredits } from "@/lib/credits"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

function useUserData<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = React.useState<{
    key: string
    value?: T
    error?: string
  }>()
  const [retry, setRetry] = React.useState(0)
  React.useEffect(() => {
    if (!key) return
    let active = true
    load()
      .then((value) => {
        if (active) setState({ key: `${key}:${retry}`, value })
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            key: `${key}:${retry}`,
            error:
              error instanceof Error
                ? error.message
                : "Unable to load user details.",
          })
      })
    return () => {
      active = false
    }
  }, [key, load, retry])
  const current = state?.key === `${key}:${retry}`
  return {
    value: current ? state.value : undefined,
    error: current ? state.error : undefined,
    loading: Boolean(key) && !current,
    retry: () => setRetry((n) => n + 1),
  }
}

export function UserDetailContent({ user }: { user: CurrentUser }) {
  const userId = new URLSearchParams(window.location.search).get("id") ?? ""
  const loadUser = React.useCallback(
    () =>
      listUsers().then(
        (users) =>
          users.find((item) => item.id === userId) ??
          Promise.reject(new Error("User not found."))
      ),
    [userId]
  )
  const loadCredits = React.useCallback(() => getUserCredits(userId), [userId])
  const loadHistory = React.useCallback(
    () => listUserCreditHistory(userId, { page: 1, pageSize: 10 }),
    [userId]
  )
  const loadAudit = React.useCallback(() => getUserAdminAudit(userId), [userId])
  const loadUsage = React.useCallback(
    () => getUserUsage(userId, {}, true),
    [userId]
  )
  const userState = useUserData(loadUser, userId)
  const target = userState.value
  const credits = useUserData(loadCredits, userId)
  const history = useUserData(loadHistory, userId)
  const audit = useUserData(loadAudit, userId)
  const usage = useUserData(loadUsage, userId)

  if (userState.loading)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-12 w-64 max-w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  if (!target)
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>
            {userId ? "Unable to load user" : "Select a user"}
          </CardTitle>
          <CardDescription>
            {userId
              ? (userState.error ?? "The user could not be found.")
              : "Open an account from the Users directory to see its details."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <a href="/dashboard/users">Back to users</a>
          </Button>
        </CardContent>
      </Card>
    )

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <a href="/dashboard/users">
          <ArrowLeft data-icon="inline-start" />
          Users
        </a>
      </Button>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-3xl">
            {target.email}
          </h2>
          <p className="mt-1 text-xs break-all text-muted-foreground">
            User ID <span className="font-mono">{target.id}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {target.id === user.id && <Badge variant="outline">You</Badge>}
          <Badge variant={target.is_active ? "secondary" : "destructive"}>
            {target.is_active ? "Active" : "Inactive"}
          </Badge>
          <Badge variant="outline">
            {target.role === "superuser" ? "Superuser" : "User"}
          </Badge>
        </div>
      </div>
      <Tabs defaultValue="overview" className="min-w-0 gap-4">
        <TabsList className="h-auto! max-w-full flex-wrap justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="credits">Credits</TabsTrigger>
          <TabsTrigger value="audit">Admin activity</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="flex flex-col gap-4">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              label="Account status"
              value={target.is_active ? "Active" : "Inactive"}
              note="Sign-in and API key access"
            />
            <SummaryCard
              label="Request tracing"
              value={target.tracing_enabled ? "Enabled" : "Disabled"}
              note="Recorded request analytics"
            />
            <SummaryCard
              label="Available credits"
              value={
                credits.value
                  ? formatCredits(credits.value.available_credits)
                  : credits.loading
                    ? "Loading…"
                    : "Unavailable"
              }
              note="Ready for new requests"
            />
            <SummaryCard
              label="Credits in use"
              value={
                credits.value
                  ? formatCredits(credits.value.reserved_credits)
                  : credits.loading
                    ? "Loading…"
                    : "Unavailable"
              }
              note="Held for active requests"
            />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Account settings</CardTitle>
              <CardDescription>
                Telemetry is managed by the user. Request tracing is managed by
                a Superuser.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Badge variant="outline">
                Telemetry {target.telemetry_enabled ? "on" : "off"}
              </Badge>
              <Badge variant="outline">
                Tracing {target.tracing_enabled ? "on" : "off"}
              </Badge>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="usage">
          <Card>
            <CardHeader>
              <CardTitle>Request usage</CardTitle>
              <CardDescription>
                Recorded attempts and provider reported tokens across this
                user’s account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {usage.loading ? (
                <Skeleton className="h-32 w-full" />
              ) : usage.value ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryCard
                    label="Traced calls"
                    value={usage.value.totals.call_count.toLocaleString()}
                    note="Provider attempts"
                  />
                  <SummaryCard
                    label="Successful"
                    value={usage.value.totals.successful_call_count.toLocaleString()}
                    note="Recorded attempts"
                  />
                  <SummaryCard
                    label="Reported tokens"
                    value={(
                      usage.value.totals.input_tokens +
                      usage.value.totals.output_tokens
                    ).toLocaleString()}
                    note="Input and output"
                  />
                  <SummaryCard
                    label="Average latency"
                    value={
                      usage.value.totals.average_latency_ms === null
                        ? "—"
                        : `${usage.value.totals.average_latency_ms.toLocaleString()} ms`
                    }
                    note="Reported call latency"
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-destructive">
                    {usage.error ?? "Usage analytics unavailable."}
                  </p>
                  <Button variant="outline" onClick={usage.retry}>
                    Try again
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="credits" className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {credits.value ? (
              <>
                <SummaryCard
                  label="Available"
                  value={formatCredits(credits.value.available_credits)}
                  note="Ready for requests"
                />
                <SummaryCard
                  label="Reserved"
                  value={formatCredits(credits.value.reserved_credits)}
                  note="Currently held"
                />
                <SummaryCard
                  label="Remaining"
                  value={formatCredits(credits.value.remaining_credits)}
                  note="Current balance"
                />
              </>
            ) : (
              <Card className="sm:col-span-3">
                <CardContent className="pt-6">
                  {credits.error ?? "Loading credit balance…"}
                </CardContent>
              </Card>
            )}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Credit history</CardTitle>
              <CardAction>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={credits.loading || history.loading}
                  onClick={() => {
                    credits.retry()
                    history.retry()
                  }}
                >
                  <RefreshCw data-icon="inline-start" />
                  Refresh
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {history.value ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Change</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.value.items.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>
                          {new Date(entry.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {formatCredits(entry.credits)}
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          {entry.reason}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : history.loading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <p className="text-sm text-destructive">{history.error}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle>Admin activity</CardTitle>
            </CardHeader>
            <CardContent>
              {audit.loading ? (
                <Skeleton className="h-24 w-full" />
              ) : audit.value?.length ? (
                <ul className="flex flex-col gap-3">
                  {audit.value.map((entry) => (
                    <li key={entry.id} className="rounded-lg border p-3">
                      <p className="font-medium">{entry.detail}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {entry.actor_email} ·{" "}
                        {new Date(entry.created_at).toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {audit.error ?? "No admin changes recorded."}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note: string
}) {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  )
}
