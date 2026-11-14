import * as React from "react"
import { LifeBuoy, Plus, LogIn, ArrowRight } from "lucide-react"

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
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <LifeBuoy className="size-6" />
        </div>
        <h3 className="text-xl font-bold text-foreground">
          You are signed in{user?.email ? ` as ${user.email}` : ""}
        </h3>
        <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted-foreground sm:text-sm">
          Access your personal support dashboard to raise new technical tickets,
          track responses from our engineering staff, and view resolution
          history.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button asChild>
            <a href="/dashboard/support">
              <LifeBuoy className="mr-1.5 size-4" />
              Open Ticket Desk
              <ArrowRight className="ml-1.5 size-4" />
            </a>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border/80 bg-muted/20 p-8 text-center shadow-xs">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <LifeBuoy className="size-6" />
      </div>
      <h3 className="text-xl font-bold text-foreground">
        Sign in to raise a support ticket
      </h3>
      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted-foreground sm:text-sm">
        To prevent spam and provide personalized assistance linked directly to
        your model groups and API keys, tickets can only be raised by verified
        account holders.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button asChild>
          <a href="/login?next=%2Fdashboard%2Fsupport">
            <LogIn className="mr-1.5 size-4" />
            Sign in to Raise Ticket
          </a>
        </Button>
        <Button variant="outline" asChild>
          <a href="/signup">
            <Plus className="mr-1.5 size-4" />
            Create Account
          </a>
        </Button>
      </div>
    </div>
  )
}
