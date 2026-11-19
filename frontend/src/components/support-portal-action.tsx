import * as React from "react"

import {
  getCachedUser,
  hasAuthTokens,
  validateSession,
  type CurrentUser,
} from "@/lib/auth"
import { Button } from "@/components/ui/button"

export function SupportPortalAction() {
  const [user, setUser] = React.useState<CurrentUser | null>(() =>
    getCachedUser()
  )
  const [isAuth, setIsAuth] = React.useState<boolean>(() => hasAuthTokens())

  React.useEffect(() => {
    if (hasAuthTokens()) {
      void validateSession().then((verifiedUser) => {
        if (verifiedUser) {
          setUser(verifiedUser)
        } else {
          setIsAuth(false)
          setUser(null)
        }
      })
    }
  }, [])

  if (isAuth) {
    return (
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-8 text-center shadow-xs">
        <h3 className="text-xl font-bold text-foreground">
          You are signed in{user?.email ? ` as ${user.email}` : ""}
        </h3>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button asChild>
            <a href="/dashboard/support">Open support tickets</a>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border/80 bg-muted/20 p-8 text-center shadow-xs">
      <h3 className="text-xl font-bold text-foreground">
        Sign in to raise a support ticket
      </h3>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button asChild>
          <a href="/login?next=%2Fdashboard%2Fsupport">Sign in</a>
        </Button>
        <Button variant="outline" asChild>
          <a href="/signup">Create account</a>
        </Button>
      </div>
    </div>
  )
}
