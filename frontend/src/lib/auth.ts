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
  // The cached user belongs to the token session.
  clearCachedUser()
}

// Last validated /users/me response, keyed to the token session. AuthGate
// seeds its initial state from it so client-side navigation paints the page
// instantly instead of flashing the session-check placeholder; the check is
// still revalidated by every AuthGate mount.
const USER_CACHE_KEY = "gateway.current_user"

export function getCachedUser(): CurrentUser | null {
  if (typeof window === "undefined") return null
  try {
    const cached = window.sessionStorage.getItem(USER_CACHE_KEY)
    return cached ? (JSON.parse(cached) as CurrentUser) : null
  } catch {
    return null
  }
}

export function cacheUser(user: CurrentUser) {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(user))
  } catch {
    // Storage unavailable: only the instant paint is lost, not correctness.
  }
}

function clearCachedUser() {
  if (typeof window === "undefined") return
  window.sessionStorage.removeItem(USER_CACHE_KEY)
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
  // A string fetch body defaults to text/plain, which the API rejects with
  // MALFORMED_INPUT; make application/json the implied content type.
  if (typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

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

export type ApiKeyItem = {
  id: string
  name: string
  key_prefix: string
  owner_id: string
  created_at: string
  last_used_at: string | null
  revoked: boolean
  revoked_at: string | null
}

export type ApiKeyList = {
  items: ApiKeyItem[]
  total: number
}

export type ApiKeyCreated = ApiKeyItem & {
  api_key: string
}

export type ApiKeyRevoked = {
  id: string
  name: string
  key_prefix: string
  revoked: boolean
  revoked_at: string | null
}

export function listApiKeys(): Promise<ApiKeyList> {
  return authenticatedRequest<ApiKeyList>("/api-keys")
}

export function createApiKey(name: string): Promise<ApiKeyCreated> {
  return authenticatedRequest<ApiKeyCreated>("/api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  })
}

export function revokeApiKey(keyId: string): Promise<ApiKeyRevoked> {
  return authenticatedRequest<ApiKeyRevoked>(`/api-keys/${keyId}/revoke`, {
    method: "POST",
  })
}

export async function deleteApiKey(keyId: string): Promise<void> {
  await authenticatedRequest<void>(`/api-keys/${keyId}`, {
    method: "DELETE",
  })
}

export type ProviderProtocol = "openai" | "anthropic"

export type Provider = {
  id: string
  name: string
  aliases: string
  base_url: string
  protocol: ProviderProtocol
  is_enabled: boolean
  has_api_key: boolean
  has_custom_header: boolean
  created_at: string
  updated_at: string
}

export type ProviderModel = {
  id: string
  provider_id: string
  model_name: string
  model_id: string
  is_available: boolean
  last_seen_at: string | null
  created_at: string
  updated_at: string
}

export type ProviderSyncResult = {
  provider_id: string
  provider_alias: string
  synced: number
  created: number
  updated: number
  unavailable: number
  models: {
    model_name: string
    model_id: string
  }[]
}

export type ProviderInput = {
  name: string
  aliases: string
  base_url: string
  protocol: ProviderProtocol
  api_key?: string
  custom_header?: Record<string, string>
}

export type ProviderUpdate = {
  name?: string
  aliases?: string
  base_url?: string
  protocol?: ProviderProtocol
  api_key?: string
  custom_header?: Record<string, string> | null
  is_enabled?: boolean
}

export function listProviders(): Promise<Provider[]> {
  return authenticatedRequest<Provider[]>("/provider")
}

export function getProvider(providerId: string): Promise<Provider> {
  return authenticatedRequest<Provider>(`/provider/${providerId}`)
}

export function createProvider(input: ProviderInput): Promise<Provider> {
  return authenticatedRequest<Provider>("/provider/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
}

export function updateProvider(
  providerId: string,
  changes: ProviderUpdate
): Promise<Provider> {
  return authenticatedRequest<Provider>(`/provider/update/${providerId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  })
}

export function disableProvider(providerId: string): Promise<Provider> {
  return authenticatedRequest<Provider>(`/provider/disable/${providerId}`, {
    method: "POST",
  })
}

export async function deleteProvider(providerId: string): Promise<void> {
  await authenticatedRequest<void>(`/provider/delete/${providerId}`, {
    method: "DELETE",
  })
}

export function listProviderModels(
  providerId: string
): Promise<ProviderModel[]> {
  return authenticatedRequest<ProviderModel[]>(`/provider/models/${providerId}`)
}

export function syncProviderModels(
  providerId: string
): Promise<ProviderSyncResult> {
  return authenticatedRequest<ProviderSyncResult>(
    `/provider/models/${providerId}`,
    {
      method: "POST",
    }
  )
}

export type RoutingStrategy = "round_robin" | "weighted_round_robin"

export type ModelGroupMember = {
  id: string
  provider_model_id: string
  provider_id: string
  provider_name: string
  provider_alias: string
  model_name: string
  provider_model_id_public: string
  weight: number
  priority: number
  is_available: boolean
}

export type ModelGroup = {
  id: string
  name: string
  model_id: string
  routing_strategy: RoutingStrategy
  is_enabled: boolean
  members: ModelGroupMember[]
  member_count: number
  created_by: string
  created_at: string
  updated_at: string
}

export type ModelGroupList = {
  items: ModelGroup[]
  page: number
  page_size: number
  total: number
}

export type ModelGroupMemberInput = {
  provider_model_id: string
  weight: number
  priority: number
}

export type ModelGroupInput = {
  name: string
  model_id: string
  routing_strategy: RoutingStrategy
  is_enabled: boolean
  members?: ModelGroupMemberInput[]
}

export type ModelGroupUpdate = {
  name?: string
  model_id?: string
  routing_strategy?: RoutingStrategy
  is_enabled?: boolean
  members?: ModelGroupMemberInput[]
}

export type ModelGroupMemberUpdate = {
  weight?: number
  priority?: number
}

export function listModelGroups(
  options: {
    page?: number
    pageSize?: number
    isEnabled?: boolean
    routingStrategy?: RoutingStrategy
  } = {}
): Promise<ModelGroupList> {
  const params = new URLSearchParams()
  const { page, pageSize, isEnabled, routingStrategy } = options
  if (page !== undefined) params.set("page", String(page))
  if (pageSize !== undefined) params.set("page_size", String(pageSize))
  if (isEnabled !== undefined) params.set("is_enabled", String(isEnabled))
  if (routingStrategy !== undefined)
    params.set("routing_strategy", routingStrategy)
  const query = params.toString()
  return authenticatedRequest<ModelGroupList>(
    `/model-groups${query ? `?${query}` : ""}`
  )
}

export function getModelGroup(groupId: string): Promise<ModelGroup> {
  return authenticatedRequest<ModelGroup>(`/model-groups/${groupId}`)
}

export function createModelGroup(input: ModelGroupInput): Promise<ModelGroup> {
  return authenticatedRequest<ModelGroup>("/model-groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
}

export function updateModelGroup(
  groupId: string,
  changes: ModelGroupUpdate
): Promise<ModelGroup> {
  return authenticatedRequest<ModelGroup>(`/model-groups/${groupId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  })
}

export function addModelGroupMember(
  groupId: string,
  input: ModelGroupMemberInput
): Promise<ModelGroup> {
  return authenticatedRequest<ModelGroup>(`/model-groups/${groupId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
}

export function updateModelGroupMember(
  groupId: string,
  memberId: string,
  changes: ModelGroupMemberUpdate
): Promise<ModelGroup> {
  return authenticatedRequest<ModelGroup>(
    `/model-groups/${groupId}/members/${memberId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    }
  )
}

export async function deleteModelGroupMember(
  groupId: string,
  memberId: string
): Promise<void> {
  await authenticatedRequest<void>(
    `/model-groups/${groupId}/members/${memberId}`,
    {
      method: "DELETE",
    }
  )
}

// --- User management (superuser-only) ---

// GET /users and PATCH /users/{user_id} return the same shape as /users/me;
// the only supported update field is is_active (role changes are not mounted).
// Deactivating a superuser is rejected by the backend with a 400.
export function listUsers(): Promise<CurrentUser[]> {
  return authenticatedRequest<CurrentUser[]>("/users")
}

export function updateUserActive(
  userId: string,
  isActive: boolean
): Promise<CurrentUser> {
  return authenticatedRequest<CurrentUser>(`/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_active: isActive }),
  })
}
