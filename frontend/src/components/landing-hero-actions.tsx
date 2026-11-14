"use client"

import * as React from "react"
import { ArrowRight, Terminal } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import { hasAuthTokens } from "@/lib/auth"

export interface LandingHeroActionsProps {
  apiDocsUrl: string
}

export function LandingHeroActions({ apiDocsUrl }: LandingHeroActionsProps) {
  const [isAuth, setIsAuth] = React.useState(() => {
    if (typeof window !== "undefined") {
      return hasAuthTokens()
    }
    return false
  })

  React.useEffect(() => {
    const handleStorage = () => {
      setIsAuth(hasAuthTokens())
    }
    window.addEventListener("storage", handleStorage)
    return () => window.removeEventListener("storage", handleStorage)
  }, [])

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      {isAuth ? (
        <a
          href="/dashboard"
          className={buttonVariants({
            variant: "default",
            size: "lg",
            className: "rounded-full px-6 font-semibold shadow-xs",
          })}
        >
          Open Dashboard
          <ArrowRight className="size-4" />
        </a>
      ) : (
        <a
          href="/signup"
          className={buttonVariants({
            variant: "default",
            size: "lg",
            className: "rounded-full px-6 font-semibold shadow-xs",
          })}
        >
          Get Started Free
          <ArrowRight className="size-4" />
        </a>
      )}

      <a
        href="/dashboard/playground"
        className={buttonVariants({
          variant: "outline",
          size: "lg",
          className: "rounded-full px-5 font-medium",
        })}
      >
        <Terminal className="size-4" />
        Try Playground
      </a>

      <a
        href={apiDocsUrl}
        target="_blank"
        rel="noreferrer"
        className={buttonVariants({
          variant: "ghost",
          size: "lg",
          className:
            "rounded-full px-4 text-xs font-medium text-muted-foreground hover:text-foreground",
        })}
      >
        API Docs ↗
      </a>
    </div>
  )
}
