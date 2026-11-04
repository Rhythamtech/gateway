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
  // Persisted /traces recording opt-in (superuser-managed).
  tracing_enabled: boolean
  // OpenTelemetry span opt-in (self-service).
  telemetry_enabled: boolean
}

type ErrorPayload = {
  detail?: string | { msg?: string }[]
  message?: string
  // Versioned envelope used by the /model-groups and /traces error contracts:
  // {"error": {"code", "message", "details", "request_id"}} (backend/main.py
  // _versioned_error). Read here so backend messages surface verbatim.
  error?: { message?: string }
}

export const API_BASE_URL = (
  import.meta.env.PUBLIC_API_BASE_URL ?? "http://localhost:8000"
).replace(/\/$/, "")
const ACCESS_TOKEN_KEY = "gateway.access_token"
const REFRESH_TOKEN_KEY = "gateway.refresh_token"
const PLAYGROUND_API_KEY = "gateway.playground_api_key"

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
  clearPlaygroundApiKey()
}

export function getPlaygroundApiKey(): string | null {
  if (typeof window === "undefined") return null
  return window.sessionStorage.getItem(PLAYGROUND_API_KEY)
}

export function setPlaygroundApiKey(key: string) {
  if (typeof window === "undefined") return
  window.sessionStorage.setItem(PLAYGROUND_API_KEY, key.trim())
}

export function clearPlaygroundApiKey() {
  if (typeof window === "undefined") return
  window.sessionStorage.removeItem(PLAYGROUND_API_KEY)
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
      } else if (payload.error?.message) message = payload.error.message
      else if (payload.message) message = payload.message
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

export type RoutingStrategy =
  "round_robin" | "weighted_round_robin" | "priority"

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

// PATCH /users/me/preferences is self-service for every signed-in user; it
// toggles only the caller's own OpenTelemetry span opt-in.
export function updateMyPreferences(
  telemetryEnabled: boolean
): Promise<CurrentUser> {
  return authenticatedRequest<CurrentUser>("/users/me/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ telemetry_enabled: telemetryEnabled }),
  })
}

// PATCH /users/{user_id} is superuser-only; tracing_enabled decides whether
// that user's inference traffic is persisted to the /traces pages.
export function updateUserTracing(
  userId: string,
  tracingEnabled: boolean
): Promise<CurrentUser> {
  return authenticatedRequest<CurrentUser>(`/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tracing_enabled: tracingEnabled }),
  })
}

// --- LLM usage analytics (role scoping enforced by the backend) ---

// Operational usage of actual gateway/provider attempts, including retries —
// never billing numbers. Timestamps carry no fabricated figures: token counts
// and average latency are null when the provider did not report them.
export type UsageTotals = {
  call_count: number
  successful_call_count: number
  failed_call_count: number
  input_tokens: number
  output_tokens: number
  cache_tokens: number
  total_latency_ms: number
  average_latency_ms: number | null
}

export type DailyUsageEntry = {
  date: string
  call_count: number
  successful_call_count: number
  failed_call_count: number
  input_tokens: number
  output_tokens: number
  cache_tokens: number
  total_latency_ms: number
  average_latency_ms: number | null
}

export type UsageSubjectType = "api_key" | "gateway_model" | "user"

export type UsageAnalytics = {
  subject_type: UsageSubjectType
  subject_id: string
  from_date: string
  to_date: string
  totals: UsageTotals
  daily: DailyUsageEntry[]
}

export type UsageRange = {
  // Inclusive date bounds (YYYY-MM-DD). Omit both for the backend default
  // window: the subject's creation date through today (UTC).
  from?: string
  to?: string
}

// GET /traces/usage/api-keys/{key_id} — owner or superuser.
export function getApiKeyUsage(
  keyId: string,
  range: UsageRange = {}
): Promise<UsageAnalytics> {
  return authenticatedRequest<UsageAnalytics>(
    `/traces/usage/api-keys/${keyId}${buildUsageRangeQuery(range)}`
  )
}

// GET /traces/usage/gateway-models/{model_id} — any authenticated user.
// Regular users receive only their own usage for the model; superusers
// receive totals across all users. Subject id is the model-group UUID.
export function getGatewayModelUsage(
  modelId: string,
  range: UsageRange = {}
): Promise<UsageAnalytics> {
  return authenticatedRequest<UsageAnalytics>(
    `/traces/usage/gateway-models/${modelId}${buildUsageRangeQuery(range)}`
  )
}

// GET /traces/usage/users/{user_id} — superuser only.
export function getUserUsage(
  userId: string,
  range: UsageRange = {}
): Promise<UsageAnalytics> {
  return authenticatedRequest<UsageAnalytics>(
    `/traces/usage/users/${userId}${buildUsageRangeQuery(range)}`
  )
}

function buildUsageRangeQuery(range: UsageRange) {
  const params = new URLSearchParams()
  if (range.from) params.set("from", range.from)
  if (range.to) params.set("to", range.to)
  const query = params.toString()
  return query ? `?${query}` : ""
}

// --- LLM traces (inspection is superuser-only) ---

// Read-only, operational data: one row per inbound message/request, and one
// row per actual gateway/provider attempt (retries included). Provider-reported
// token figures are null when the provider did not report them, and request
// payloads are stored sanitized (+ truncated at a size cap) by the backend.
export type GatewayModelRef = {
  id: string | null
  model_id: string
}

export type ProviderModelRef = {
  id: string
  model_id: string
  provider_id: string
  provider_name: string
  provider_alias: string
}

export type TraceMessageStatus = "pending" | "success" | "failed" | "timeout"

export type MessageTraceItem = {
  id: string
  user_id: string
  message_id: string | null
  api_key_id: string | null
  request: Record<string, unknown> | null
  status: TraceMessageStatus
  call_count: number
  successful_call_count: number
  failed_call_count: number
  input_tokens: number | null
  output_tokens: number | null
  cache_tokens: number | null
  total_latency_ms: number | null
  created_at: string
  finished_at: string | null
}

export type MessageTraceDetail = MessageTraceItem & {
  calls: CallTraceItem[]
}

// One exact call record (shared by list, detail, and message's calls[]).
// Tokens are provider-reported (null when unavailable).
export type CallTraceItem = {
  id: string
  message_trace_id: string
  user_id: string
  message_id: string | null
  api_key_id: string | null
  gateway_model: GatewayModelRef | null
  provider_model: ProviderModelRef | null
  request: Record<string, unknown> | null
  input_tokens: number | null
  output_tokens: number | null
  cache_tokens: number | null
  uncached_input_tokens: number | null
  cache_read_tokens: number | null
  cache_write_tokens: number | null
  latency_ms: number | null
  status: string
  error_code: string | null
  created_at: string
  finished_at: string | null
}

export type MessagesPage = {
  items: MessageTraceItem[]
  page: number
  page_size: number
  total: number
}

export type CallsPage = {
  items: CallTraceItem[]
  page: number
  page_size: number
  total: number
}

// Only the query filters the backend documents for GET /traces/calls; all are
// optional. from/to are inclusive dates.
export type CallTraceFilters = {
  user_id?: string
  message_id?: string
  api_key_id?: string
  gateway_model_id?: string
  provider_model_id?: string
  status?: string
  from?: string
  to?: string
}

export type CallTraceFilterOptions = {
  page?: number
  pageSize?: number
  filters?: CallTraceFilters
}

export function listMessageTraces(
  options: { page?: number; pageSize?: number } = {}
): Promise<MessagesPage> {
  const params = new URLSearchParams()
  if (options.page !== undefined) params.set("page", String(options.page))
  if (options.pageSize !== undefined)
    params.set("page_size", String(options.pageSize))
  const query = params.toString()
  return authenticatedRequest<MessagesPage>(
    `/traces/messages${query ? `?${query}` : ""}`
  )
}

export function getMessageTrace(traceId: string): Promise<MessageTraceDetail> {
  return authenticatedRequest<MessageTraceDetail>(`/traces/messages/${traceId}`)
}

export function listCallTraces(
  options: CallTraceFilterOptions = {}
): Promise<CallsPage> {
  const params = new URLSearchParams()
  if (options.page !== undefined) params.set("page", String(options.page))
  if (options.pageSize !== undefined)
    params.set("page_size", String(options.pageSize))
  const filters = options.filters ?? {}
  for (const [key, value] of Object.entries(filters)) {
    const trimmed = value.trim()
    if (trimmed) params.set(key, trimmed)
  }
  const query = params.toString()
  return authenticatedRequest<CallsPage>(
    `/traces/calls${query ? `?${query}` : ""}`
  )
}

export function getCallTrace(callId: string): Promise<CallTraceItem> {
  return authenticatedRequest<CallTraceItem>(`/traces/calls/${callId}`)
}

// --- Inference & Models (V1 Gateway API) ---

export type GatewayModelItem = {
  id: string
  object: "model"
  created: number
  owned_by: string
}

export type GatewayModelList = {
  object: "list"
  data: GatewayModelItem[]
}

export async function listV1Models(apiKey: string): Promise<GatewayModelList> {
  const response = await fetch(`${API_BASE_URL}/v1/models`, {
    headers: {
      "x-api-key": apiKey.trim(),
    },
  })
  if (!response.ok) {
    let message = `Failed to load models (${response.status})`
    try {
      const err = await response.json()
      if (err?.error?.message) message = err.error.message
      else if (err?.detail)
        message = typeof err.detail === "string" ? err.detail : message
    } catch {
      // fallback
    }
    throw new ApiError(message, response.status)
  }
  return response.json() as Promise<GatewayModelList>
}
