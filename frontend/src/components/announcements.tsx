import * as React from "react"
import { Plus, Megaphone, Pencil, RotateCw } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageContent } from "@/components/dashboard-shell"
import { toast } from "sonner"
import {
  getAnnouncements,
  saveAnnouncement,
  republishAnnouncement,
  listCoupons,
  type Announcement,
  type AnnouncementInput,
  type Coupon,
} from "@/lib/auth"
import { BannerContent } from "@/components/announcement-banner"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"

const blank: AnnouncementInput = {
  title: "",
  message: "",
  placement: "dashboard",
  audience: "users",
  status: "draft",
  priority: 0,
  dismissible: true,
  starts_at: null,
  ends_at: null,
  coupon_id: null,
  action_label: null,
  action_url: null,
}
function Choice({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((v) => (
              <SelectItem key={v} value={v}>
                {v}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}
export function AnnouncementsContent() {
  const [editorOpen, setEditorOpen] = React.useState(false)
  const [filter, setFilter] = React.useState("all")
  const [items, setItems] = React.useState<Announcement[] | null>(null)
  const [coupons, setCoupons] = React.useState<Coupon[]>([])
  const [data, setData] = React.useState<AnnouncementInput>(blank)
  const [id, setId] = React.useState<string>()
  const [error, setError] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [revision, refresh] = React.useReducer((n: number) => n + 1, 0)
  React.useEffect(() => {
    let stopped = false
    async function load() {
      try {
        const [announcements, first] = await Promise.all([
          getAnnouncements(),
          listCoupons(1),
        ])
        const all = [...first.items]
        for (let page = 2; all.length < first.total; page++) {
          const next = await listCoupons(page)
          if (!next.items.length) break
          all.push(...next.items)
        }
        if (!stopped) {
          setItems(announcements)
          setCoupons(all)
          setError("")
        }
      } catch (e) {
        if (!stopped)
          setError(
            e instanceof Error ? e.message : "Could not load announcements"
          )
      }
    }
    void load()
    return () => {
      stopped = true
    }
  }, [revision])
  function update<K extends keyof AnnouncementInput>(
    key: K,
    value: AnnouncementInput[K]
  ) {
    setData((d) => ({ ...d, [key]: value }))
  }
  async function save(event: React.SubmitEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      await saveAnnouncement(data, id)
      setData(blank)
      setId(undefined)
      setEditorOpen(false)
      refresh()
      window.dispatchEvent(new Event("gateway:announcements"))
      toast.success("Announcement saved")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save announcement")
    } finally {
      setBusy(false)
    }
  }
  async function republish(item: Announcement) {
    setBusy(true)
    try {
      await republishAnnouncement(item.id)
      refresh()
      window.dispatchEvent(new Event("gateway:announcements"))
      toast.success("Published as a new version")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not republish")
    } finally {
      setBusy(false)
    }
  }
  const coupon = coupons.find((c) => c.id === data.coupon_id)
  return (
    <PageContent>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h2 className="text-2xl font-semibold">Announcements</h2>
          <Button
            onClick={() => {
              setData(blank)
              setId(undefined)
              setEditorOpen(true)
            }}
          >
            <Plus data-icon="inline-start" />
            New announcement
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {["published", "draft", "withdrawn"].map((status) => (
            <Card key={status}>
              <CardHeader className="p-3 sm:p-6">
                <CardDescription className="capitalize">
                  {status}
                </CardDescription>
                <CardTitle>
                  {items
                    ? items.filter((item) => item.status === status).length
                    : "—"}
                </CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList className="h-auto max-w-full flex-wrap justify-start">
            <TabsTrigger value="all">All announcements</TabsTrigger>
            <TabsTrigger value="published">Published</TabsTrigger>
            <TabsTrigger value="draft">Drafts</TabsTrigger>
            <TabsTrigger value="withdrawn">Withdrawn</TabsTrigger>
          </TabsList>
        </Tabs>
        {error && (
          <Card role="alert">
            <CardContent>
              {error}
              <Button variant="link" onClick={refresh}>
                Retry loading
              </Button>
            </CardContent>
          </Card>
        )}
        <Sheet open={editorOpen} onOpenChange={setEditorOpen}>
          <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
            <SheetHeader>
              <SheetTitle>
                {id ? "Edit announcement" : "New announcement"}
              </SheetTitle>
              <SheetDescription>
                Choose who sees your message and when it appears.
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-4 pb-6">
              <Card>
                <CardHeader>
                  <CardTitle>
                    {id ? "Edit announcement" : "New announcement"}
                  </CardTitle>
                  <CardDescription>
                    Publish banners deliberately. Coupon creation never
                    publishes its code automatically.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={save}>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="announcement-title">
                          Title
                        </FieldLabel>
                        <Input
                          id="announcement-title"
                          required
                          maxLength={200}
                          value={data.title}
                          onChange={(e) => update("title", e.target.value)}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="announcement-message">
                          Message
                        </FieldLabel>
                        <Textarea
                          id="announcement-message"
                          required
                          maxLength={2000}
                          value={data.message}
                          onChange={(e) => update("message", e.target.value)}
                        />
                      </Field>
                      <Choice
                        id="announcement-placement"
                        label="Placement"
                        value={data.placement}
                        options={["dashboard", "landing", "both"]}
                        onChange={(v) => {
                          update(
                            "placement",
                            v as AnnouncementInput["placement"]
                          )
                          if (v !== "dashboard") update("audience", "public")
                        }}
                      />
                      <Choice
                        id="announcement-audience"
                        label="Audience"
                        value={data.audience}
                        options={
                          data.placement === "dashboard"
                            ? ["users", "superusers", "public"]
                            : ["public"]
                        }
                        onChange={(v) =>
                          update("audience", v as AnnouncementInput["audience"])
                        }
                      />
                      <Choice
                        id="announcement-status"
                        label="Status"
                        value={data.status}
                        options={["draft", "published", "withdrawn"]}
                        onChange={(v) =>
                          update("status", v as AnnouncementInput["status"])
                        }
                      />
                      <Field>
                        <FieldLabel htmlFor="announcement-priority">
                          Priority (0–100)
                        </FieldLabel>
                        <Input
                          id="announcement-priority"
                          type="number"
                          min={0}
                          max={100}
                          value={data.priority}
                          onChange={(e) =>
                            update("priority", Number(e.target.value))
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="announcement-start">
                          Start time
                        </FieldLabel>
                        <Input
                          id="announcement-start"
                          type="datetime-local"
                          value={localDate(data.starts_at)}
                          onChange={(e) =>
                            update(
                              "starts_at",
                              e.target.value
                                ? new Date(e.target.value).toISOString()
                                : null
                            )
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="announcement-end">
                          End time
                        </FieldLabel>
                        <Input
                          id="announcement-end"
                          type="datetime-local"
                          value={localDate(data.ends_at)}
                          onChange={(e) =>
                            update(
                              "ends_at",
                              e.target.value
                                ? new Date(e.target.value).toISOString()
                                : null
                            )
                          }
                        />
                      </Field>
                      <Field orientation="horizontal">
                        <Checkbox
                          id="announcement-dismissible"
                          checked={data.dismissible}
                          onCheckedChange={(v) =>
                            update("dismissible", v === true)
                          }
                        />
                        <FieldLabel htmlFor="announcement-dismissible">
                          Allow dismissal
                        </FieldLabel>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="announcement-coupon">
                          Coupon (optional)
                        </FieldLabel>
                        <Select
                          value={data.coupon_id ?? "none"}
                          onValueChange={(v) =>
                            update("coupon_id", v === "none" ? null : v)
                          }
                        >
                          <SelectTrigger id="announcement-coupon">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="none">No coupon</SelectItem>
                              {coupons.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.code} — {c.credits} credits
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                      {!data.coupon_id && (
                        <>
                          <Field>
                            <FieldLabel htmlFor="announcement-label">
                              Action label (optional)
                            </FieldLabel>
                            <Input
                              id="announcement-label"
                              maxLength={80}
                              value={data.action_label ?? ""}
                              onChange={(e) =>
                                update("action_label", e.target.value || null)
                              }
                            />
                          </Field>
                          <Field>
                            <FieldLabel htmlFor="announcement-url">
                              Action path (e.g. /dashboard/credits)
                            </FieldLabel>
                            <Input
                              id="announcement-url"
                              maxLength={500}
                              value={data.action_url ?? ""}
                              onChange={(e) =>
                                update("action_url", e.target.value || null)
                              }
                            />
                          </Field>
                        </>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button disabled={busy} type="submit">
                          {busy ? "Saving…" : "Save announcement"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setData(blank)
                            setId(undefined)
                          }}
                        >
                          Reset form
                        </Button>
                      </div>
                    </FieldGroup>
                  </form>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Preview</CardTitle>
                  <CardDescription>
                    Content preview. Live coupon availability and audience rules
                    are checked by the server.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <BannerContent
                    compact={data.placement !== "dashboard"}
                    item={{
                      id: "preview",
                      version: 1,
                      title: data.title || "Announcement title",
                      message: data.message || "Your announcement message",
                      dismissible: data.dismissible,
                      ends_at: data.ends_at,
                      action_label: coupon
                        ? "Redeem coupon"
                        : data.action_label,
                      action_url: coupon
                        ? `/dashboard/credits?coupon=${encodeURIComponent(coupon.code)}`
                        : data.action_url,
                      coupon_code: coupon?.code ?? null,
                      coupon_credits: coupon?.credits ?? null,
                    }}
                  />
                </CardContent>
              </Card>
            </div>
          </SheetContent>
        </Sheet>
        {!items && !error && <Skeleton className="h-32 w-full" />}
        {items?.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No announcements yet</EmptyTitle>
              <EmptyDescription>Save a draft to get started.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {items && items.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Messages</CardTitle>
              <CardDescription>
                Published messages appear only when their schedule and audience
                match.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className="overflow-x-auto"
                role="region"
                aria-label="Announcements"
                tabIndex={0}
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Announcement</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Placement / audience</TableHead>
                      <TableHead>Schedule</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items
                      .filter(
                        (item) => filter === "all" || item.status === filter
                      )
                      .map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div className="flex max-w-sm flex-col gap-1">
                              <span className="font-medium">{item.title}</span>
                              <span className="line-clamp-2 text-sm text-muted-foreground">
                                {item.message}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                item.status === "published"
                                  ? "default"
                                  : "secondary"
                              }
                            >
                              {item.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <span className="capitalize">
                                {item.placement}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {item.audience} · v{item.version}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1 text-xs">
                              <span>
                                {item.starts_at
                                  ? new Date(item.starts_at).toLocaleString()
                                  : "Starts immediately"}
                              </span>
                              <span className="text-muted-foreground">
                                {item.ends_at
                                  ? `Ends ${new Date(item.ends_at).toLocaleString()}`
                                  : "No end date"}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => {
                                  setId(item.id)
                                  setData(
                                    Object.fromEntries(
                                      Object.keys(blank).map((key) => [
                                        key,
                                        item[key as keyof Announcement],
                                      ])
                                    ) as AnnouncementInput
                                  )
                                  setEditorOpen(true)
                                }}
                              >
                                <Pencil data-icon="inline-start" />
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busy}
                                onClick={() => void republish(item)}
                              >
                                <RotateCw data-icon="inline-start" />
                                Republish
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    {!items.some(
                      (item) => filter === "all" || item.status === filter
                    ) && (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <Empty>
                            <EmptyHeader>
                              <Megaphone />
                              <EmptyTitle>No {filter} announcements</EmptyTitle>
                              <EmptyDescription>
                                Choose another status or create a message.
                              </EmptyDescription>
                            </EmptyHeader>
                          </Empty>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </PageContent>
  )
}
function localDate(value: string | null) {
  if (!value) return ""
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
}
