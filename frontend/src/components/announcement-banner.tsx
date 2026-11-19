import * as React from "react"
import { X, Pause, Play, Megaphone, ArrowRight } from "lucide-react"
import {
  getBanners,
  getPublicBanners,
  dismissAnnouncement,
  type Banner,
} from "@/lib/auth"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { parseApiTimestamp } from "@/lib/datetime"

export function BannerContent({
  item,
  onDismiss,
  compact = false,
}: {
  item: Banner
  onDismiss?: () => void
  compact?: boolean
}) {
  if (compact) return <AnnouncementTicker item={item} onDismiss={onDismiss} />
  return (
    <Alert
      variant="notice"
      role="status"
      className="grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3"
    >
      <span className="notice-icon">
        <Megaphone aria-hidden="true" />
      </span>
      <AlertDescription className="col-start-2 block min-w-0">
        <p>
          <strong>{item.title}</strong>
          <span> · {item.message}</span>
        </p>
        {item.coupon_code && (
          <Badge variant="secondary">
            {item.coupon_code} · {item.coupon_credits} credits
          </Badge>
        )}
        {item.ends_at && (
          <span>
            {" "}
            Ends {parseApiTimestamp(item.ends_at)?.toLocaleDateString()}
          </span>
        )}
      </AlertDescription>
      <div className="col-start-2 flex flex-wrap items-center gap-2 pt-2 sm:col-start-3 sm:row-start-1 sm:pt-0">
        {item.action_url && (
          <Button asChild size="sm" variant="outline" className="rounded-full">
            <a href={item.action_url}>
              {item.action_label}
              <ArrowRight data-icon="inline-end" />
            </a>
          </Button>
        )}
        {item.dismissible && onDismiss && (
          <Button
            size="icon"
            variant="ghost"
            onClick={onDismiss}
            aria-label="Dismiss announcement"
          >
            <X />
          </Button>
        )}
      </div>
    </Alert>
  )
}
function AnnouncementTicker({
  item,
  onDismiss,
}: {
  item: Banner
  onDismiss?: () => void
}) {
  const [paused, setPaused] = React.useState(false)
  const group = React.useRef<HTMLDivElement>(null)
  const [duration, setDuration] = React.useState(45)
  React.useEffect(() => {
    const element = group.current
    if (!element) return
    const observer = new ResizeObserver(() =>
      setDuration(Math.max(20, element.getBoundingClientRect().width / 45))
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [item])
  const copy = (
    <>
      <strong>{item.title}</strong>
      <span>{item.message}</span>
      {item.coupon_code && (
        <Badge variant="secondary">{item.coupon_code}</Badge>
      )}
      {item.ends_at && (
        <span>
          Ends {parseApiTimestamp(item.ends_at)?.toLocaleDateString()}
        </span>
      )}
    </>
  )
  return (
    <Alert
      variant="announcement"
      role="status"
      className="grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 px-2 py-1 sm:px-4"
    >
      <AlertDescription className="col-start-1 block min-w-0">
        <div
          className="announcement-ticker"
          data-paused={paused}
          tabIndex={0}
          role="region"
          aria-label="Announcement, pauses when focused"
          style={
            { "--announcement-duration": `${duration}s` } as React.CSSProperties
          }
        >
          <div className="announcement-ticker-track">
            <div ref={group} className="announcement-ticker-group">
              {[0, 1, 2].map((n) => (
                <span
                  key={n}
                  className="announcement-ticker-copy"
                  aria-hidden={n > 0 || undefined}
                >
                  {copy}
                </span>
              ))}
            </div>
            <div className="announcement-ticker-group" aria-hidden="true">
              {[0, 1, 2].map((n) => (
                <span key={n} className="announcement-ticker-copy">
                  {copy}
                </span>
              ))}
            </div>
          </div>
        </div>
      </AlertDescription>
      <div className="flex shrink-0 items-center gap-1">
        {item.action_url && (
          <Button asChild size="sm" variant="link" className="max-w-36">
            <a href={item.action_url}>
              <span className="truncate">{item.action_label}</span>
            </a>
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          aria-label={
            paused
              ? "Resume announcement scrolling"
              : "Pause announcement scrolling"
          }
          aria-pressed={paused}
          onClick={() => setPaused((value) => !value)}
        >
          {paused ? <Play /> : <Pause />}
        </Button>
        {item.dismissible && onDismiss && (
          <Button
            size="icon"
            variant="ghost"
            onClick={onDismiss}
            aria-label="Dismiss announcement"
          >
            <X />
          </Button>
        )}
      </div>
    </Alert>
  )
}

export function AnnouncementBanner({
  publicPage = false,
}: {
  publicPage?: boolean
}) {
  const [now, setNow] = React.useState(0)
  const [items, setItems] = React.useState<Banner[]>([])
  const [error, setError] = React.useState("")
  const [hidden, setHidden] = React.useState<string[]>([])
  React.useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    async function load() {
      if (document.hidden) return
      clearTimeout(timer)
      try {
        const next = await (publicPage ? getPublicBanners() : getBanners())
        if (!stopped) {
          setItems(next)
          setNow(Date.now())
          if (publicPage) {
            try {
              setHidden(
                JSON.parse(
                  localStorage.getItem("gateway:banner-dismissals") || "[]"
                )
              )
            } catch {
              /* Browser storage may be disabled. */
            }
          }
        }
      } catch {
        /* Announcements must not prevent using the application. */
      } finally {
        if (!stopped) timer = setTimeout(load, 60_000)
      }
    }
    void load()
    document.addEventListener("visibilitychange", load)
    window.addEventListener("gateway:announcements", load)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", load)
      window.removeEventListener("gateway:announcements", load)
    }
  }, [publicPage])
  const item = items.find(
    (b) =>
      !hidden.includes(`${b.id}:${b.version}`) &&
      (!b.ends_at || (parseApiTimestamp(b.ends_at)?.getTime() ?? 0) > now)
  )
  async function dismiss() {
    if (!item) return
    try {
      if (!publicPage) await dismissAnnouncement(item.id, item.version)
      const next = [...hidden, `${item.id}:${item.version}`]
      setHidden(next)
      if (publicPage) {
        try {
          localStorage.setItem(
            "gateway:banner-dismissals",
            JSON.stringify(next)
          )
        } catch {
          /* Hide for this visit when storage is unavailable. */
        }
      }
      setError("")
    } catch {
      setError("Could not dismiss this announcement. Please try again.")
    }
  }
  if (!item) return null
  return (
    <div className={publicPage ? undefined : "px-4 py-3"}>
      <BannerContent
        item={item}
        compact={publicPage}
        onDismiss={() => void dismiss()}
      />
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
