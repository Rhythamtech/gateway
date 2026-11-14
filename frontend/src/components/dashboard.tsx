import * as React from "react"
import type { TransitionBeforePreparationEvent } from "astro:transitions/client"
import { AuthGate } from "@/components/auth-gate"
import { DashboardShell, PageContent } from "@/components/dashboard-shell"
import {
  DashboardLoading,
  DashboardPageLoading,
} from "@/components/dashboard-loading"
import {
  getDashboardRoute,
  isSuperuserDashboardRoute,
} from "@/components/dashboard-routes"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

function subscribeToRoute(callback: () => void) {
  document.addEventListener("astro:after-swap", callback)
  return () => document.removeEventListener("astro:after-swap", callback)
}
function getRouteSnapshot() {
  return window.location.pathname + window.location.search
}

class PageErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <PageContent>
        <Card role="alert">
          <CardHeader>
            <CardTitle>Unable to load this page</CardTitle>
            <CardDescription>
              The page could not be loaded. Reload to try again, or choose
              another page from the sidebar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => window.location.reload()}>
              Reload page
            </Button>
          </CardContent>
        </Card>
      </PageContent>
    )
  }
}

export function Dashboard({
  currentPath = "/dashboard",
}: {
  currentPath?: string
}) {
  // Astro persists this root. The URL also handles detail?id= changes where
  // island props are identical and Astro has no reason to rerender the island.
  const routeKey = React.useSyncExternalStore(
    subscribeToRoute,
    getRouteSnapshot,
    () => currentPath
  )
  const path = routeKey.split("?")[0].replace(/\/$/, "")
  const route = getDashboardRoute(path)
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    let active: AbortSignal | undefined
    const start = (event: TransitionBeforePreparationEvent) => {
      active = event.signal
      setPending(true)
      event.signal.addEventListener(
        "abort",
        () => {
          if (active === event.signal) setPending(false)
        },
        { once: true }
      )
    }
    const finish = () => {
      active = undefined
      setPending(false)
    }
    document.addEventListener("astro:before-preparation", start)
    document.addEventListener("astro:page-load", finish)
    return () => {
      document.removeEventListener("astro:before-preparation", start)
      document.removeEventListener("astro:page-load", finish)
    }
  }, [])

  function prefetch(event: React.SyntheticEvent) {
    const target = event.target
    if (!(target instanceof Element)) return
    const link = target.closest("a[href]")
    if (
      !(link instanceof HTMLAnchorElement) ||
      link.origin !== window.location.origin ||
      link.hasAttribute("download") ||
      link.target === "_blank"
    )
      return
    // Respect constrained connections; HTML prefetch has the same policy.
    const connection = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string }
      }
    ).connection
    if (connection?.saveData || connection?.effectiveType?.includes("2g"))
      return
    const next = getDashboardRoute(link.pathname.replace(/\/$/, ""))
    if (next && next !== route)
      void next.preload().catch(() => {
        /* Render boundary handles a failed import if this route is opened. */
      })
  }

  const Page = route?.Component
  const usesPageContent =
    path === "/dashboard" ||
    path === "/dashboard/credits" ||
    path === "/dashboard/coupons" ||
    path === "/dashboard/credit-review" ||
    path === "/dashboard/users/detail" ||
    path === "/dashboard/settings"
  return (
    <AuthGate
      requiresSuperuser={isSuperuserDashboardRoute(path)}
      validationKey={routeKey}
      loadingFallback={<DashboardLoading label="Checking your session…" />}
    >
      {(user) => (
        <div onPointerOverCapture={prefetch} onFocusCapture={prefetch}>
          <DashboardShell
            currentPath={path}
            pageTitle={route?.title ?? "Dashboard"}
            role={user.role}
            user={{ name: user.email, email: user.email, role: user.role }}
          >
            {pending ? (
              <div
                role="status"
                className="border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground"
              >
                Loading next page…
              </div>
            ) : null}
            <div
              aria-busy={pending}
              className="flex flex-1 flex-col"
              data-dashboard-route={routeKey}
            >
              <PageErrorBoundary key={routeKey}>
                <React.Suspense fallback={<DashboardPageLoading />}>
                  {Page ? (
                    usesPageContent ? (
                      <PageContent>
                        <div className="flex flex-col gap-6 lg:gap-8">
                          <Page user={user} />
                        </div>
                      </PageContent>
                    ) : (
                      <div className="@container/main flex flex-1 flex-col gap-4 py-4 md:gap-6 md:py-6">
                        <Page user={user} />
                      </div>
                    )
                  ) : (
                    <PageContent>
                      <p role="alert">
                        This dashboard page is unavailable. Choose another page
                        from the sidebar.
                      </p>
                    </PageContent>
                  )}
                </React.Suspense>
              </PageErrorBoundary>
            </div>
          </DashboardShell>
        </div>
      )}
    </AuthGate>
  )
}
