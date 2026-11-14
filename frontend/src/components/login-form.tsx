import * as React from "react"
import { cn } from "cn"

import {
  ApiError,
  clearAuthTokens,
  getCachedUser,
  hasAuthTokens,
  login,
  validateSession,
  type CurrentUser,
} from "@/lib/auth"
import { APP_NAME } from "@/lib/site"
import { postLoginPath } from "@/lib/navigation"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [error, setError] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [existingUser, setExistingUser] = React.useState<CurrentUser | null>(
    () => getCachedUser()
  )

  React.useEffect(() => {
    if (hasAuthTokens()) {
      void validateSession().then((user) => {
        setExistingUser(user)
      })
    }
  }, [])

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    const formData = new FormData(event.currentTarget)
    const email = String(formData.get("email") ?? "")
    const password = String(formData.get("password") ?? "")

    try {
      await login(email, password)
      const requestedPath = new URLSearchParams(window.location.search).get(
        "next"
      )
      const nextPath = postLoginPath(requestedPath, window.location.origin)
      window.location.assign(nextPath)
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : "Unable to sign in. Please try again."
      )
      setIsSubmitting(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome to {APP_NAME}
        </h1>
        <p className="text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <a
            href="/signup"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Sign up
          </a>
        </p>
      </div>
      {existingUser ? (
        <div className="rounded-md border border-border p-4 text-center">
          <p className="text-sm text-muted-foreground">
            Signed in as{" "}
            <strong className="font-medium text-foreground">
              {existingUser.email}
            </strong>
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <Button asChild size="sm">
              <a href="/dashboard">Open Dashboard</a>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => {
                clearAuthTokens()
                setExistingUser(null)
              }}
            >
              Use another account
            </Button>
          </div>
        </div>
      ) : null}
      <form onSubmit={handleSubmit}>
        <FieldGroup className="gap-6">
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              name="email"
              autoComplete="email"
              type="email"
              placeholder="m@example.com"
              className="h-10"
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              name="password"
              autoComplete="current-password"
              type="password"
              className="h-10"
              required
            />
          </Field>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Signing in…" : "Login"}
          </Button>
        </FieldGroup>
      </form>
    </div>
  )
}
