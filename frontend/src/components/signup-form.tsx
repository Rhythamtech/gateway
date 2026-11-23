import * as React from "react"
import { cn } from "cn"

import {
  ApiError,
  clearAuthTokens,
  getCachedUser,
  hasAuthTokens,
  login,
  register,
  validateSession,
  type CurrentUser,
} from "@/lib/auth"
import { APP_NAME } from "@/lib/site"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function SignupForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [error, setError] = React.useState<string | null>(null)
  const [existingUser, setExistingUser] = React.useState<CurrentUser | null>(
    () => getCachedUser()
  )
  const [retryCredentials, setRetryCredentials] = React.useState<{
    email: string
    password: string
  } | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)

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

    const form = event.currentTarget
    const formData = new FormData(form)
    const password = String(formData.get("password") ?? "")
    const confirmPassword = String(formData.get("confirm-password") ?? "")
    if (password !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }

    setIsSubmitting(true)
    try {
      const email = String(formData.get("email") ?? "")
      await register(email, password)
      try {
        await login(email, password)
        window.location.replace("/dashboard")
      } catch {
        setRetryCredentials({ email, password })
        setError("Account created. Try signing in again.")
        form.reset()
      }
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : "Unable to create your account. Please try again."
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function retryLogin() {
    if (!retryCredentials) return
    setIsSubmitting(true)
    setError(null)
    try {
      await login(retryCredentials.email, retryCredentials.password)
      setRetryCredentials(null)
      window.location.replace("/dashboard")
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : "Unable to sign in. Please try again."
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Create your {APP_NAME} account
        </h1>
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <a
            href="/login"
            className="font-medium text-primary underline underline-offset-4"
          >
            Sign in
          </a>
        </p>
      </div>
      {existingUser ? (
        <div className="rounded-md border border-border p-4">
          <p className="text-sm text-muted-foreground">
            Signed in as{" "}
            <strong className="font-medium text-foreground">
              {existingUser.email}
            </strong>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button asChild size="sm">
              <a href="/dashboard">Open dashboard</a>
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
              className="h-10 bg-background"
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              aria-describedby="signup-password-length"
              minLength={8}
              maxLength={128}
              className="h-10 bg-background"
              required
            />
            <p
              id="signup-password-length"
              className="text-xs text-muted-foreground"
            >
              Use 8 to 128 characters.
            </p>
          </Field>
          <Field>
            <FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
            <Input
              id="confirm-password"
              name="confirm-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              className="h-10 bg-background"
              required
            />
          </Field>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {retryCredentials ? (
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={isSubmitting}
              onClick={retryLogin}
            >
              {isSubmitting ? "Signing in…" : "Retry sign in"}
            </Button>
          ) : (
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Creating account…" : "Create account"}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            Request tracing stores sanitized request details by default. You can
            turn it off in Settings.
          </p>
        </FieldGroup>
      </form>
    </div>
  )
}
