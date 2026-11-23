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
      <div className="rounded-lg border border-border bg-muted p-5">
        <h2 className="text-base font-semibold break-words">
          You are signed in{user?.email ? ` as ${user.email}` : ""}
        </h2>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button asChild>
            <a href="/dashboard/support">Open support tickets</a>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-muted p-5">
      <h2 className="text-base font-semibold break-words">
        Open a support ticket
      </h2>
      <div className="mt-4 flex flex-wrap items-center gap-2">
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
