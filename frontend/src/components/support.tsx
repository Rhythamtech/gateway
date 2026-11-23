import * as React from "react"
import { toast } from "sonner"
import {
  LifeBuoy,
  Plus,
  Search,
  MessageSquare,
  ShieldCheck,
  Send,
  CheckCircle2,
  RefreshCw,
} from "lucide-react"

import {
  addSupportTicketMessage,
  createSupportTicket,
  getSupportStats,
  getSupportTicket,
  listSupportTickets,
  updateSupportTicketStatus,
  type CurrentUser,
  type SupportCategory,
  type SupportPriority,
  type SupportStats,
  type SupportStatus,
  type SupportTicketDetail,
  type SupportTicketItem,
} from "@/lib/auth"
import { formatTimestampInDeviceZone, parseApiTimestamp } from "@/lib/datetime"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Message, MessageContent, MessageGroup } from "@/components/ui/message"
import { Bubble, BubbleContent } from "@/components/ui/bubble"

const CATEGORY_LABELS: Record<SupportCategory, string> = {
  billing: "Billing & Credits",
  api_keys: "API Keys",
  model_routing: "Model Routing",
  latency: "Latency & Outages",
  account: "Account",
  other: "General Inquiries",
}

function formatInstant(val: string | null | undefined): string {
  const d = parseApiTimestamp(val)
  return d ? formatTimestampInDeviceZone(d) : "—"
}

function StatusBadge({ status }: { status: SupportStatus }) {
  switch (status) {
    case "open":
      return (
        <Badge
          variant="outline"
          className="border-amber-500/40 bg-amber-500/10 font-medium text-amber-600 dark:text-amber-400"
        >
          <span className="mr-1.5 size-1.5 rounded-full bg-amber-500" />
          Open
        </Badge>
      )
    case "in_progress":
      return (
        <Badge
          variant="outline"
          className="border-blue-500/40 bg-blue-500/10 font-medium text-blue-600 dark:text-blue-400"
        >
          <span className="mr-1.5 size-1.5 animate-pulse rounded-full bg-blue-500" />
          In progress
        </Badge>
      )
    case "resolved":
      return (
        <Badge
          variant="outline"
          className="border-emerald-500/40 bg-emerald-500/10 font-medium text-emerald-600 dark:text-emerald-400"
        >
          <span className="mr-1.5 size-1.5 rounded-full bg-emerald-500" />
          Resolved
        </Badge>
      )
    case "closed":
      return (
        <Badge
          variant="outline"
          className="border-muted-foreground/30 bg-muted/20 font-medium text-muted-foreground"
        >
          <span className="mr-1.5 size-1.5 rounded-full bg-muted-foreground" />
          Closed
        </Badge>
      )
  }
}

function PriorityBadge({ priority }: { priority: SupportPriority }) {
  switch (priority) {
    case "urgent":
      return (
        <Badge variant="destructive" className="text-[11px] font-medium">
          Urgent
        </Badge>
      )
    case "high":
      return (
        <Badge
          variant="outline"
          className="border-rose-500/40 bg-rose-500/10 text-[11px] font-medium text-rose-600 dark:text-rose-400"
        >
          High
        </Badge>
      )
    case "normal":
      return (
        <Badge variant="secondary" className="text-[11px] font-normal">
          Normal
        </Badge>
      )
    case "low":
      return (
        <Badge
          variant="outline"
          className="text-[11px] font-normal text-muted-foreground"
        >
          Low
        </Badge>
      )
  }
}

export function SupportDashboardContent({ user }: { user: CurrentUser }) {
  const isSuperuser = user.role === "superuser"

  const [tickets, setTickets] = React.useState<SupportTicketItem[]>([])
  const [stats, setStats] = React.useState<SupportStats | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isRefreshing, setIsRefreshing] = React.useState(false)

  // Filters
  const [statusFilter, setStatusFilter] = React.useState<string>("all")
  const [categoryFilter, setCategoryFilter] = React.useState<string>("all")
  const [searchQuery, setSearchQuery] = React.useState("")

  // Active Ticket Drawer (View Thread)
  const [activeTicketId, setActiveTicketId] = React.useState<string | null>(
    () => new URLSearchParams(window.location.search).get("id")
  )
  const [ticketDetail, setTicketDetail] =
    React.useState<SupportTicketDetail | null>(null)
  const [replyMessage, setReplyMessage] = React.useState("")
  const [isSendingReply, setIsSendingReply] = React.useState(false)

  // Create Ticket Sheet
  const [isCreateOpen, setIsCreateOpen] = React.useState(false)
  const [createSubject, setCreateSubject] = React.useState("")
  const [createCategory, setCreateCategory] =
    React.useState<SupportCategory>("other")
  const [createPriority, setCreatePriority] =
    React.useState<SupportPriority>("normal")
  const [createMessage, setCreateMessage] = React.useState("")
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [revision, setRevision] = React.useState(0)

  const refresh = React.useCallback((quiet = false) => {
    if (quiet) setIsRefreshing(true)
    else setIsLoading(true)
    setRevision((v) => v + 1)
  }, [])

  React.useEffect(() => {
    let active = true

    Promise.all([
      listSupportTickets({
        status: statusFilter === "all" ? undefined : statusFilter,
        category: categoryFilter === "all" ? undefined : categoryFilter,
        search: searchQuery.trim() || undefined,
        page_size: 50,
      }),
      isSuperuser ? getSupportStats() : Promise.resolve(null),
    ])
      .then(([ticketsRes, statsRes]) => {
        if (!active) return
        setTickets(ticketsRes.items)
        if (statsRes) setStats(statsRes)
        setIsLoading(false)
        setIsRefreshing(false)
      })
      .catch((err) => {
        if (!active) return
        toast.error(
          err instanceof Error ? err.message : "Failed to load tickets"
        )
        setIsLoading(false)
        setIsRefreshing(false)
      })

    return () => {
      active = false
    }
  }, [statusFilter, categoryFilter, searchQuery, isSuperuser, revision])

  React.useEffect(() => {
    if (!activeTicketId) return
    let active = true

    getSupportTicket(activeTicketId)
      .then((detail) => {
        if (active) setTicketDetail(detail)
      })
      .catch((err) => {
        if (!active) return
        toast.error(
          err instanceof Error ? err.message : "Failed to load ticket details"
        )
        setActiveTicketId(null)
      })

    return () => {
      active = false
    }
  }, [activeTicketId])

  const handleOpenTicket = (ticketId: string) => {
    setTicketDetail(null)
    setReplyMessage("")
    setActiveTicketId(ticketId)
  }

  // Handle send message
  const handleSendMessage = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!activeTicketId || !replyMessage.trim()) return

    setIsSendingReply(true)
    try {
      const newMsg = await addSupportTicketMessage(
        activeTicketId,
        replyMessage.trim()
      )
      setReplyMessage("")
      setTicketDetail((prev) =>
        prev
          ? {
              ...prev,
              messages: [...prev.messages, newMsg],
              message_count: prev.message_count + 1,
              status:
                isSuperuser && prev.status === "open"
                  ? "in_progress"
                  : prev.status,
            }
          : null
      )
      toast.success("Reply submitted")
      refresh(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send message")
    } finally {
      setIsSendingReply(false)
    }
  }

  // Handle status update
  const handleStatusChange = async (newStatus: SupportStatus) => {
    if (!activeTicketId) return
    try {
      const updated = await updateSupportTicketStatus(activeTicketId, newStatus)
      setTicketDetail((prev) =>
        prev ? { ...prev, status: updated.status } : null
      )
      toast.success(`Ticket marked as ${newStatus.replace("_", " ")}`)
      refresh(true)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update status"
      )
    }
  }

  // Handle create ticket
  const handleCreateTicket = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!createSubject.trim() || !createMessage.trim()) {
      toast.error("Please fill in both subject and description")
      return
    }

    setIsSubmitting(true)
    try {
      const created = await createSupportTicket({
        subject: createSubject.trim(),
        category: createCategory,
        priority: createPriority,
        message: createMessage.trim(),
      })
      toast.success("Support ticket created successfully")
      setIsCreateOpen(false)
      setCreateSubject("")
      setCreateMessage("")
      setCreateCategory("other")
      setCreatePriority("normal")
      refresh(true)
      handleOpenTicket(created.id)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create support ticket"
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <h1 className="text-2xl font-bold tracking-tight">Support tickets</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refresh(true)}
            disabled={isRefreshing}
          >
            <RefreshCw
              className={`mr-1.5 size-3.5 ${isRefreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus className="mr-1.5 size-4" />
            New ticket
          </Button>
        </div>
      </div>

      {/* Superuser KPI Stat Cards using shadcn Card */}
      {isSuperuser && stats ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card className="gap-2 p-4 shadow-xs">
            <CardHeader className="p-0">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                Total tickets
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 pt-2">
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>

          <Card className="gap-2 border-amber-500/20 bg-amber-500/5 p-4 shadow-xs">
            <CardHeader className="p-0">
              <CardTitle className="text-xs font-medium text-amber-600 dark:text-amber-400">
                Open
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 pt-2">
              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                {stats.open}
              </div>
              <CardDescription className="text-xs text-muted-foreground">
                Awaiting initial reply
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="gap-2 border-blue-500/20 bg-blue-500/5 p-4 shadow-xs">
            <CardHeader className="p-0">
              <CardTitle className="text-xs font-medium text-blue-600 dark:text-blue-400">
                In progress
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 pt-2">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {stats.in_progress}
              </div>
            </CardContent>
          </Card>

          <Card className="gap-2 border-emerald-500/20 bg-emerald-500/5 p-4 shadow-xs">
            <CardHeader className="p-0">
              <CardTitle className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                Resolved and closed
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 pt-2">
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {stats.resolved + stats.closed}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Filter and Search Bar using shadcn Tabs and Select */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Status Tabs */}
        <Tabs
          value={statusFilter}
          onValueChange={setStatusFilter}
          className="w-auto"
        >
          <TabsList className="h-8">
            <TabsTrigger value="all" className="text-xs">
              All
            </TabsTrigger>
            <TabsTrigger value="open" className="text-xs">
              Open
            </TabsTrigger>
            <TabsTrigger value="in_progress" className="text-xs">
              In progress
            </TabsTrigger>
            <TabsTrigger value="resolved" className="text-xs">
              Resolved
            </TabsTrigger>
            <TabsTrigger value="closed" className="text-xs">
              Closed
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Category & Search Filter */}
        <div className="flex items-center gap-2">
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger size="sm" className="w-[170px] text-xs">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative w-48 sm:w-64">
            <Search className="pointer-events-none absolute top-2 left-2.5 size-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder={
                isSuperuser ? "Search subject or user..." : "Search subject..."
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>
      </div>

      {/* Tickets Table / List inside shadcn Card */}
      <Card className="overflow-hidden p-0">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-6">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <div className="mb-3 rounded-full bg-muted/60 p-4">
                <LifeBuoy className="size-8 text-muted-foreground" />
              </div>
              <h3 className="text-base font-semibold">
                No support tickets found
              </h3>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {statusFilter !== "all" ||
                categoryFilter !== "all" ||
                searchQuery
                  ? "No tickets match your filter criteria. Try resetting filters."
                  : isSuperuser
                    ? "No tickets have been submitted by users yet."
                    : "Need assistance with billing, providers, or latency? Raise your first support ticket."}
              </p>
              {!isSuperuser && (
                <Button
                  size="sm"
                  className="mt-4"
                  onClick={() => setIsCreateOpen(true)}
                >
                  <Plus className="mr-1.5 size-4" />
                  Raise a Ticket
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead>Subject</TableHead>
                  {isSuperuser && (
                    <TableHead className="w-[180px]">User</TableHead>
                  )}
                  <TableHead className="w-[100px]">Priority</TableHead>
                  <TableHead className="w-[90px] text-center">
                    Messages
                  </TableHead>
                  <TableHead className="w-[170px]">Updated</TableHead>
                  <TableHead className="w-[110px] text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((t) => (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleOpenTicket(t.id)}
                  >
                    <TableCell>
                      <StatusBadge status={t.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">
                          {t.subject}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {CATEGORY_LABELS[t.category] || t.category}
                        </span>
                      </div>
                    </TableCell>
                    {isSuperuser && (
                      <TableCell>
                        <span className="block max-w-[180px] truncate text-xs text-muted-foreground">
                          {t.user_email || t.user_id}
                        </span>
                      </TableCell>
                    )}
                    <TableCell>
                      <PriorityBadge priority={t.priority} />
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <MessageSquare className="size-3" />
                        {t.message_count}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatInstant(t.updated_at)}
                    </TableCell>
                    <TableCell
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => handleOpenTicket(t.id)}
                      >
                        View Thread
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Ticket Conversation Thread Sheet using shadcn Message, Bubble, Avatar */}
      <Sheet
        open={Boolean(activeTicketId)}
        onOpenChange={(open) => !open && setActiveTicketId(null)}
      >
        <SheetContent
          side="right"
          className="flex w-full flex-col p-0 sm:max-w-2xl"
        >
          {!ticketDetail ? (
            <div className="flex flex-col gap-4 p-6">
              <SheetTitle className="sr-only">Support ticket</SheetTitle>
              <SheetDescription className="sr-only">
                Loading ticket details.
              </SheetDescription>
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <>
              {/* Drawer Header */}
              <SheetHeader className="px-6 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <SheetTitle className="text-lg font-bold">
                      {ticketDetail.subject}
                    </SheetTitle>
                    <SheetDescription className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <StatusBadge status={ticketDetail.status} />
                      <PriorityBadge priority={ticketDetail.priority} />
                      <span className="text-muted-foreground">
                        Category:{" "}
                        {CATEGORY_LABELS[ticketDetail.category] ||
                          ticketDetail.category}
                      </span>
                      {ticketDetail.user_email && (
                        <span className="text-muted-foreground">
                          · Raised by {ticketDetail.user_email}
                        </span>
                      )}
                    </SheetDescription>
                  </div>
                </div>

                {/* Status Actions using shadcn Select */}
                <div className="mt-3 flex items-center justify-between border-t pt-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    Ticket Status:
                  </span>
                  {isSuperuser ? (
                    <Select
                      value={ticketDetail.status}
                      onValueChange={(val) =>
                        void handleStatusChange(val as SupportStatus)
                      }
                    >
                      <SelectTrigger
                        size="sm"
                        className="h-7 w-[130px] text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="in_progress">In progress</SelectItem>
                        <SelectItem value="resolved">Resolved</SelectItem>
                        <SelectItem value="closed">Closed</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    ticketDetail.status !== "resolved" &&
                    ticketDetail.status !== "closed" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => void handleStatusChange("resolved")}
                      >
                        <CheckCircle2 className="mr-1.5 size-3.5 text-emerald-500" />
                        Mark as Resolved
                      </Button>
                    )
                  )}
                </div>
              </SheetHeader>

              <Separator />

              {/* Message Thread Body using shadcn Message, Avatar, Bubble */}
              <div className="flex-1 space-y-4 overflow-y-auto p-6">
                <MessageGroup className="gap-4">
                  {ticketDetail.messages.map((m) => {
                    const isStaff = m.sender_role === "superuser"
                    return (
                      <Message key={m.id} align="start" className="gap-3">
                        {isStaff ? (
                          <Avatar
                            size="sm"
                            className="border border-blue-500/20 bg-blue-500/10 text-blue-600"
                          >
                            <AvatarFallback>
                              <ShieldCheck className="size-3.5" />
                            </AvatarFallback>
                          </Avatar>
                        ) : (
                          <Avatar size="sm">
                            <AvatarFallback>
                              {(m.sender_email?.[0] || "U").toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        )}
                        <MessageContent>
                          <div className="flex items-center gap-2 text-xs">
                            {isStaff ? (
                              <>
                                <span className="font-semibold text-blue-600 dark:text-blue-400">
                                  Gateway Support
                                </span>
                                <Badge
                                  variant="outline"
                                  className="h-4 border-blue-500/30 px-1 py-0 text-[10px] text-blue-600 dark:text-blue-400"
                                >
                                  Staff
                                </Badge>
                              </>
                            ) : (
                              <span className="font-semibold text-foreground">
                                {m.sender_email || "User"}
                              </span>
                            )}
                            <span className="text-[11px] text-muted-foreground">
                              {formatInstant(m.created_at)}
                            </span>
                          </div>
                          <Bubble
                            variant={isStaff ? "secondary" : "outline"}
                            className="max-w-[95%]"
                          >
                            <BubbleContent className="text-sm leading-relaxed whitespace-pre-wrap">
                              {m.message}
                            </BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    )
                  })}
                </MessageGroup>
              </div>

              <Separator />

              {/* Reply Box Footer */}
              <div className="bg-muted/20 p-4">
                <form onSubmit={handleSendMessage} className="space-y-3">
                  <Textarea
                    placeholder={
                      ticketDetail.status === "closed"
                        ? "This ticket is closed. Sending a reply will re-open it."
                        : "Type your reply to this ticket..."
                    }
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    rows={3}
                    className="resize-none text-sm"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">
                      {isSuperuser
                        ? "Replies will notify the user and appear with the Gateway Support staff badge."
                        : "Our engineering staff responds promptly during working hours."}
                    </span>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={isSendingReply || !replyMessage.trim()}
                    >
                      <Send className="mr-1.5 size-3.5" />
                      {isSendingReply ? "Sending..." : "Send Reply"}
                    </Button>
                  </div>
                </form>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Raise New Ticket Sheet using shadcn FieldGroup, Field, FieldLabel, Select, Input, Textarea */}
      <Sheet open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col p-6 sm:max-w-lg"
        >
          <SheetHeader className="mb-4">
            <SheetTitle className="text-lg font-bold">
              Raise a Support Ticket
            </SheetTitle>
            <SheetDescription className="text-xs">
              Describe your issue or technical inquiry. Our engineering team
              reviews all tickets.
            </SheetDescription>
          </SheetHeader>

          <form
            onSubmit={handleCreateTicket}
            className="flex flex-1 flex-col justify-between space-y-4"
          >
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="ticket-subject">Subject *</FieldLabel>
                <Input
                  id="ticket-subject"
                  required
                  placeholder="e.g. 504 Timeout on claude-3-5-sonnet provider"
                  value={createSubject}
                  onChange={(e) => setCreateSubject(e.target.value)}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel>Category</FieldLabel>
                  <Select
                    value={createCategory}
                    onValueChange={(val) =>
                      setCreateCategory(val as SupportCategory)
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                        <SelectItem key={k} value={k}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel>Priority</FieldLabel>
                  <Select
                    value={createPriority}
                    onValueChange={(val) =>
                      setCreatePriority(val as SupportPriority)
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low (General)</SelectItem>
                      <SelectItem value="normal">Normal (Standard)</SelectItem>
                      <SelectItem value="high">High (Production)</SelectItem>
                      <SelectItem value="urgent">Urgent (Outage)</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="ticket-description">
                  Description & Details *
                </FieldLabel>
                <Textarea
                  id="ticket-description"
                  required
                  rows={6}
                  placeholder="Please include model identifiers, request IDs, timestamps, or reproduction payloads..."
                  value={createMessage}
                  onChange={(e) => setCreateMessage(e.target.value)}
                  className="text-sm"
                />
              </Field>
            </FieldGroup>

            <SheetFooter className="flex items-center justify-end gap-2 border-t pt-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Submit Ticket"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  )
}
