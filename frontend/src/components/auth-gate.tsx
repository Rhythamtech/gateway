import * as React from "react"

import {
  ApiError,
  cacheUser,
  clearAuthTokens,
  getCachedUser,
  getCurrentUser,
  type CurrentUser,
} from "@/lib/auth"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type AuthGateProps = {
  children: (user: CurrentUser) => React.ReactNode
  requiresSuperuser?: boolean
}

export function AuthGate({
  children,
  requiresSuperuser = false,
}: AuthGateProps) {
  // Seeded from the previous successful session check (see the cache helpers
  // in lib/auth.ts) so route changes that remount this gate paint the page
  // immediately. The revalidation below still runs on every mount.
  const [user, setUser] = React.useState<CurrentUser | null>(getCachedUser)
  const [error, setError] = React.useState<string | null>(null)
  const [retryCount, setRetryCount] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false

    getCurrentUser()
      .then((currentUser) => {
        if (cancelled) return
        setUser(currentUser)
        cacheUser(currentUser)
      })
      .catch((requestError: unknown) => {
        if (cancelled) return

        if (requestError instanceof ApiError && requestError.status === 401) {
          clearAuthTokens()
          const next = `${window.location.pathname}${window.location.search}`
          window.location.replace(`/login?next=${encodeURIComponent(next)}`)
          return
        }

        // When a previously validated session is already on screen, transient
        // refetch failures shouldn't blank the page; the next mount retries.
        // Fresh visits still show the blocking error card, and the 401 expiry
        // case above always redirects.
        if (getCachedUser()) return

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to verify your session. Please try again."
        )
      })

    return () => {
      cancelled = true
    }
  }, [retryCount])

  if (!user && !error) {
    return (
      <div
        className="flex min-h-64 items-center justify-center p-6"
        role="status"
      >
        <p className="text-sm text-muted-foreground">Checking your session…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-64 items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Unable to load your account</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => {
                setError(null)
                setUser(null)
                setRetryCount((count) => count + 1)
              }}
            >
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (requiresSuperuser && user?.role !== "superuser") {
    return (
      <div className="flex min-h-64 items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access denied</CardTitle>
            <CardDescription>
              This page is available to superusers only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <a href="/dashboard">Back to dashboard</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return user ? children(user) : null
}
