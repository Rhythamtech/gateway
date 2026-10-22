export type AuthTokens = {
  access_token: string
  refresh_token: string
  token_type: "bearer" | string
}

export type CurrentUser = {
  id: string
  email: string
  role: "user" | "superuser"
  is_active: boolean
}

type ErrorPayload = {
  detail?: string | { msg?: string }[]
  message?: string
}

const API_BASE_URL = (
  import.meta.env.PUBLIC_API_BASE_URL ?? "http://localhost:8000"
).replace(/\/$/, "")
const ACCESS_TOKEN_KEY = "gateway.access_token"
const REFRESH_TOKEN_KEY = "gateway.refresh_token"

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = "ApiError"
  }
}

function saveTokens(tokens: AuthTokens) {
  window.sessionStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token)
  window.sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token)
}

export function clearAuthTokens() {
  if (typeof window === "undefined") return
  window.sessionStorage.removeItem(ACCESS_TOKEN_KEY)
  window.sessionStorage.removeItem(REFRESH_TOKEN_KEY)
}

function getTokens() {
  if (typeof window === "undefined") return null
  const accessToken = window.sessionStorage.getItem(ACCESS_TOKEN_KEY)
  const refreshToken = window.sessionStorage.getItem(REFRESH_TOKEN_KEY)
  if (!accessToken && !refreshToken) return null
  return { accessToken, refreshToken }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const payload = (await response.json()) as ErrorPayload
      if (typeof payload.detail === "string") message = payload.detail
      else if (Array.isArray(payload.detail)) {
        message =
          payload.detail
            .map((item) => item.msg)
            .filter(Boolean)
            .join("; ") || message
      } else if (payload.message) message = payload.message
    } catch {
      // Keep the status-based message when the response has no JSON body.
    }
    throw new ApiError(message, response.status)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

async function refreshTokens(): Promise<AuthTokens> {
  const tokens = getTokens()
  if (!tokens?.refreshToken) {
    clearAuthTokens()
    throw new ApiError("Your session has expired. Please sign in again.", 401)
  }

  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: tokens.refreshToken }),
    })
    const refreshed = await parseResponse<AuthTokens>(response)
    saveTokens(refreshed)
    return refreshed
  } catch (error) {
    clearAuthTokens()
    throw error
  }
}

async function authenticatedRequest<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  let tokens = getTokens()
  if (!tokens?.accessToken) {
    if (!tokens?.refreshToken)
      throw new ApiError("Authentication required", 401)
    await refreshTokens()
    tokens = getTokens()
  }

  const headers = new Headers(init.headers)
  headers.set("Authorization", `Bearer ${tokens?.accessToken}`)

  let response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers })
  if (response.status === 401) {
    await refreshTokens()
    tokens = getTokens()
    headers.set("Authorization", `Bearer ${tokens?.accessToken}`)
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers })
  }

  return parseResponse<T>(response)
}

export async function register(email: string, password: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  await parseResponse<CurrentUser>(response)
}

export async function login(email: string, password: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  saveTokens(await parseResponse<AuthTokens>(response))
}

export function getCurrentUser(): Promise<CurrentUser> {
  return authenticatedRequest<CurrentUser>("/users/me")
}

export function signOut() {
  clearAuthTokens()
  window.location.assign("/login")
}
