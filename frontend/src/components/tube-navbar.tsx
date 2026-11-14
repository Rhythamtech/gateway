"use client"

import * as React from "react"
import { ArrowRight, ExternalLink, Menu } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import { ThemeToggle } from "@/components/theme-toggle"
import { APP_NAME } from "@/lib/site"
import { clearAuthTokens, getCachedUser, hasAuthTokens } from "@/lib/auth"

export interface TubeNavbarProps {
  current?: "home" | "about" | "support" | "privacy" | "terms"
}

export function TubeNavbar({ current }: TubeNavbarProps) {
  const [isAuth, setIsAuth] = React.useState(() => {
    if (typeof window !== "undefined") {
      return hasAuthTokens()
    }
    return false
  })
  const [userEmail, setUserEmail] = React.useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return getCachedUser()?.email ?? null
    }
    return null
  })
  const [isOpen, setIsOpen] = React.useState(false)

  React.useEffect(() => {
    const handleStorage = () => {
      setIsAuth(hasAuthTokens())
      setUserEmail(getCachedUser()?.email ?? null)
    }
    window.addEventListener("storage", handleStorage)
    return () => window.removeEventListener("storage", handleStorage)
  }, [])

  const apiBaseUrl = (
    import.meta.env?.PUBLIC_API_BASE_URL ?? "http://localhost:8000"
  ).replace(/\/$/, "")

  const navLinks = [
    { label: "Home", href: "/", id: "home" },
    { label: "About", href: "/about", id: "about" },
    { label: "Support", href: "/support", id: "support" },
    {
      label: "API Docs",
      href: `${apiBaseUrl}/docs`,
      target: "_blank",
      id: "docs",
    },
  ]

  const handleSignOut = () => {
    clearAuthTokens()
    setIsAuth(false)
    setUserEmail(null)
    setIsOpen(false)
  }

  return (
    <header className="fixed inset-x-0 top-3 z-50 mx-auto w-[calc(100%-1.5rem)] max-w-4xl transition-all duration-200 sm:top-5 sm:w-[calc(100%-3rem)]">
      <div className="flex h-12 items-center justify-between rounded-full border border-border/70 bg-background/80 px-3 shadow-xs backdrop-blur-md transition-colors sm:h-13 sm:px-4">
        {/* Brand */}
        <a
          href="/"
          className="flex items-center gap-2 pr-2 pl-1 text-sm font-semibold tracking-tight text-foreground transition-opacity hover:opacity-85"
          aria-label={`${APP_NAME} Home`}
        >
          <img
            src="/brand/logo.png"
            alt=""
            className="size-6 object-contain dark:invert"
          />
          <span className="font-semibold">{APP_NAME}</span>
        </a>

        {/* Desktop Navigation Links */}
        <nav
          className="hidden items-center gap-1 text-xs font-medium text-muted-foreground md:flex"
          aria-label="Public Navigation"
        >
          {navLinks.map((link) => {
            const isActive = current === link.id
            return (
              <a
                key={link.id}
                href={link.href}
                target={link.target}
                rel={link.target ? "noreferrer" : undefined}
                className={cn(
                  "rounded-full px-3.5 py-1.5 transition-colors",
                  isActive
                    ? "bg-muted font-semibold text-foreground"
                    : "hover:bg-muted/50 hover:text-foreground"
                )}
              >
                {link.label}
              </a>
            )
          })}
        </nav>

        {/* Right Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <ThemeToggle className="size-8 rounded-full" />

          {/* Desktop Auth Button */}
          {isAuth ? (
            <a
              href="/dashboard"
              className={buttonVariants({
                variant: "default",
                size: "sm",
                className:
                  "h-8 rounded-full px-3.5 text-xs font-medium shadow-xs",
              })}
            >
              Dashboard
              <ArrowRight className="size-3.5" />
            </a>
          ) : (
            <div className="flex items-center gap-1">
              <a
                href="/login"
                className={buttonVariants({
                  variant: "ghost",
                  size: "sm",
                  className:
                    "hidden h-8 rounded-full px-3 text-xs text-muted-foreground hover:text-foreground sm:inline-flex",
                })}
              >
                Sign in
              </a>
              <a
                href="/signup"
                className={buttonVariants({
                  variant: "default",
                  size: "sm",
                  className:
                    "h-8 rounded-full px-3.5 text-xs font-medium shadow-xs",
                })}
              >
                Get Started
              </a>
            </div>
          )}

          {/* Mobile Sheet Navigation */}
          <div className="md:hidden">
            <Sheet open={isOpen} onOpenChange={setIsOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-full text-muted-foreground hover:text-foreground"
                  aria-label="Toggle menu"
                >
                  <Menu className="size-4" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="top"
                className="rounded-b-2xl border-border/80 bg-background/95 p-6 backdrop-blur-lg"
              >
                <SheetHeader className="pb-2 text-left">
                  <SheetTitle className="flex items-center gap-2 text-base font-semibold">
                    <img
                      src="/brand/logo.png"
                      alt=""
                      className="size-5 object-contain dark:invert"
                    />
                    <span>{APP_NAME}</span>
                  </SheetTitle>
                </SheetHeader>
                <nav
                  className="flex flex-col gap-1 py-4"
                  aria-label="Mobile Navigation"
                >
                  {navLinks.map((link) => (
                    <a
                      key={link.id}
                      href={link.href}
                      target={link.target}
                      rel={link.target ? "noreferrer" : undefined}
                      onClick={() => setIsOpen(false)}
                      className={cn(
                        "flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        current === link.id
                          ? "bg-muted font-semibold text-foreground"
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      )}
                    >
                      <span>{link.label}</span>
                      {link.target ? (
                        <ExternalLink className="size-3.5 opacity-50" />
                      ) : null}
                    </a>
                  ))}
                  <a
                    href="/privacy"
                    onClick={() => setIsOpen(false)}
                    className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  >
                    Privacy Policy
                  </a>
                  <a
                    href="/terms"
                    onClick={() => setIsOpen(false)}
                    className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  >
                    Terms of Service
                  </a>
                </nav>
                <Separator className="my-2" />
                <div className="flex flex-col gap-2 pt-2">
                  {isAuth ? (
                    <>
                      {userEmail ? (
                        <div className="truncate px-1 text-xs text-muted-foreground">
                          Signed in as{" "}
                          <span className="font-semibold text-foreground">
                            {userEmail}
                          </span>
                        </div>
                      ) : null}
                      <a
                        href="/dashboard"
                        onClick={() => setIsOpen(false)}
                        className={buttonVariants({
                          variant: "default",
                          size: "sm",
                          className: "w-full rounded-full",
                        })}
                      >
                        Open Dashboard
                      </a>
                      <Button
                        variant="outline"
                        className="w-full rounded-full"
                        size="sm"
                        onClick={handleSignOut}
                      >
                        Sign out
                      </Button>
                    </>
                  ) : (
                    <>
                      <a
                        href="/signup"
                        onClick={() => setIsOpen(false)}
                        className={buttonVariants({
                          variant: "default",
                          size: "sm",
                          className: "w-full rounded-full",
                        })}
                      >
                        Get Started
                      </a>
                      <a
                        href="/login"
                        onClick={() => setIsOpen(false)}
                        className={buttonVariants({
                          variant: "outline",
                          size: "sm",
                          className: "w-full rounded-full",
                        })}
                      >
                        Sign in
                      </a>
                    </>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </header>
  )
}
