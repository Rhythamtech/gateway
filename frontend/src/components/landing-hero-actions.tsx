"use client"

import * as React from "react"

import { buttonVariants } from "@/components/ui/button"
import { hasAuthTokens } from "@/lib/auth"

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback)
  window.addEventListener("pageshow", callback)
  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener("pageshow", callback)
  }
}

export function LandingHeroActions() {
  const isAuth = React.useSyncExternalStore(
    subscribe,
    hasAuthTokens,
    () => false
  )

  return (
    <div className="flex flex-wrap items-center gap-3">
      <a
        href={isAuth ? "/dashboard" : "/signup"}
        className={buttonVariants({ size: "lg" })}
      >
        {isAuth ? "Open dashboard" : "Create account"}
      </a>
      <a
        href="/dashboard/playground"
        className={buttonVariants({ variant: "outline", size: "lg" })}
      >
        Open Playground
      </a>
    </div>
  )
}
