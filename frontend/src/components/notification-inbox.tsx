import { NotificationPreferences } from "@/components/notification-preferences"
import * as React from "react"
import {
  Bell,
  Coins,
  KeyRound,
  ArrowUpRight,
  Check,
  LifeBuoy,
} from "lucide-react"
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type NotificationPage,
} from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { parseApiTimestamp } from "@/lib/datetime"

export function NotificationInbox({
  onSupportUnreadChange,
}: {
  onSupportUnreadChange: (count: number) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [filter, setFilter] = React.useState("all")
  const [data, setData] = React.useState<NotificationPage | null>(null)
  const [page, setPage] = React.useState(1)
  const [error, setError] = React.useState("")
  const [revision, refresh] = React.useReducer((n: number) => n + 1, 0)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    let delay = 60_000
    let fetching = false
    async function load() {
      if (document.hidden || fetching) return
      fetching = true
      clearTimeout(timer)
      try {
        const result = await getNotifications(page)
        if (!cancelled) {
          setData(result)
          onSupportUnreadChange(result.unread_support_count ?? 0)
          window.dispatchEvent(
            new CustomEvent("gateway:credit-status", {
              detail: {
                warning: result.credit_warning,
                available: result.available_credits,
              },
            })
          )
          setError("")
          delay = 60_000
        }
      } catch {
        if (!cancelled) {
          setError("Notifications could not be refreshed.")
          delay = Math.min(delay * 2, 300_000)
        }
      } finally {
        fetching = false
        if (!cancelled) timer = setTimeout(load, delay)
      }
    }
    void load()
    document.addEventListener("visibilitychange", load)
    window.addEventListener("gateway:notifications", load)
    return () => {
      cancelled = true
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", load)
      window.removeEventListener("gateway:notifications", load)
    }
  }, [page, revision, onSupportUnreadChange])
  async function read(id?: string) {
    setBusy(true)
    try {
      if (id) await markNotificationRead(id)
      else await markAllNotificationsRead()
      refresh()
    } catch {
      setError("Could not mark notifications as read. Try again.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) refresh()
      }}
    >
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Notifications${data ? `, ${data.unread_count} unread` : ""}`}
        >
          <Bell />
          {!!data?.unread_count && <Badge>{data.unread_count}</Badge>}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Notifications</SheetTitle>
          <SheetDescription>
            Support, credit and account updates.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tabs value={filter} onValueChange={setFilter}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="unread">
                  Unread{" "}
                  <Badge variant="secondary">{data?.unread_count ?? 0}</Badge>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || !data?.unread_count}
              onClick={() => read()}
            >
              <Check data-icon="inline-start" />
              Read all
            </Button>
          </div>
          <Separator />
          {error && (
            <Alert variant="destructive">
              <AlertDescription>
                {error}
                <Button variant="link" onClick={refresh}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {!data && !error && <Skeleton className="h-24 w-full" />}
          {data?.items.filter((item) => filter !== "unread" || !item.read_at)
            .length === 0 && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>You’re all caught up</EmptyTitle>
                <EmptyDescription>
                  Your updates will appear here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {data?.items
            .filter((item) => filter !== "unread" || !item.read_at)
            .map((item) => (
              <React.Fragment key={item.id}>
                <article className="flex items-start gap-3 py-2">
                  <span
                    className="notice-icon"
                    data-severity={
                      item.kind === "credit_alert" ? "exhausted" : "info"
                    }
                  >
                    {item.kind === "key_expiry" ? (
                      <KeyRound aria-hidden="true" />
                    ) : item.kind === "support_ticket" ? (
                      <LifeBuoy aria-hidden="true" />
                    ) : (
                      <Coins aria-hidden="true" />
                    )}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-medium">
                        {item.title.replace(/(\d+)\.000000/g, "$1")}
                      </h3>
                      {!item.read_at && <Badge variant="secondary">New</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {item.message}
                    </p>
                    <time
                      className="text-xs text-muted-foreground"
                      dateTime={item.created_at}
                    >
                      {parseApiTimestamp(item.created_at)?.toLocaleString()}
                    </time>
                    <div className="flex flex-wrap gap-1">
                      <Button asChild variant="link" size="sm">
                        <a
                          href={item.action_url}
                          onClick={() => setOpen(false)}
                        >
                          {item.kind === "support_ticket"
                            ? "Open ticket"
                            : "View details"}
                          <ArrowUpRight data-icon="inline-end" />
                        </a>
                      </Button>
                      {!item.read_at && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => read(item.id)}
                        >
                          Mark read
                        </Button>
                      )}
                    </div>
                  </div>
                </article>
                <Separator />
              </React.Fragment>
            ))}
          <p className="text-xs text-muted-foreground">
            Filters apply to this page of notifications.
          </p>
          {!!data && data.total > 20 && (
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="outline"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <span>Page {page}</span>
              <Button
                variant="outline"
                disabled={page * 20 >= data.total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          )}
          <NotificationPreferences />
        </div>
      </SheetContent>
    </Sheet>
  )
}
