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
  import.meta.env?.PUBLIC_API_BASE_URL ?? "http://localhost:8000"
).replace(/\/$/, "")
const ACCESS_TOKEN_KEY = "gateway.access_token"
const REFRESH_TOKEN_KEY = "gateway.refresh_token"
const PLAYGROUND_API_KEY = "gateway.playground_api_key"

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
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

export function hasAuthTokens(): boolean {
  return Boolean(getTokens())
}

export async function validateSession(): Promise<CurrentUser | null> {
  if (!hasAuthTokens()) return null
  const cached = getCachedUser()
  try {
    const user = await getCurrentUser()
    cacheUser(user)
    return user
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearAuthTokens()
      return null
    }
    return cached
  }
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
  expires_at: string | null
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

export type ApiKeyExpiry = "1h" | "24h" | "1week" | "never"

export function createApiKey(
  name: string,
  expiresIn?: ApiKeyExpiry | "" | null
): Promise<ApiKeyCreated> {
  return authenticatedRequest<ApiKeyCreated>("/api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, expires_in: expiresIn || null }),
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
  initial_credits?: string
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
// toggles the caller's own OpenTelemetry span and usage tracing opt-in.
export function updateMyPreferences(
  input: boolean | { telemetryEnabled?: boolean; tracingEnabled?: boolean }
): Promise<CurrentUser> {
  const body: { telemetry_enabled?: boolean; tracing_enabled?: boolean } = {}
  if (typeof input === "boolean") {
    body.telemetry_enabled = input
  } else {
    if (input.telemetryEnabled !== undefined) {
      body.telemetry_enabled = input.telemetryEnabled
    }
    if (input.tracingEnabled !== undefined) {
      body.tracing_enabled = input.tracingEnabled
    }
  }
  return authenticatedRequest<CurrentUser>("/users/me/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

export type UserAdminAuditItem = {
  id: string
  actor_email: string
  action: string
  detail: string
  created_at: string
}

export function getUserAdminAudit(
  userId: string
): Promise<UserAdminAuditItem[]> {
  return authenticatedRequest<UserAdminAuditItem[]>(`/users/${userId}/audit`)
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

// Daily credits actually charged (settled credit usage), aggregated
// read-side from the ledger. Decimal credit strings follow the credit
// contract; cost is null for subjects the ledger cannot attribute
// (per-gateway-model analytics).
export type DailyCostEntry = {
  date: string
  charged_credits: string
}

export type UsageCost = {
  totals: { charged_credits: string }
  daily: DailyCostEntry[]
}

export type UsageAnalytics = {
  subject_type: UsageSubjectType
  subject_id: string
  from_date: string
  to_date: string
  totals: UsageTotals
  daily: DailyUsageEntry[]
  hourly?:
    | {
        hour: number
        successful_call_count: number
        failed_call_count: number
      }[]
    | null
  cost?: UsageCost | null
}

export type UsageRange = {
  // Inclusive date bounds (YYYY-MM-DD). Omit both for the backend default
  // window: the subject's creation date through today (UTC).
  from?: string
  to?: string
}

export type LogRetention = "24h" | "7d" | "30d" | "never"

export function getLogRetention(): Promise<{ log_retention: LogRetention }> {
  return authenticatedRequest("/traces/retention")
}

export function updateLogRetention(
  logRetention: LogRetention
): Promise<{ log_retention: LogRetention }> {
  return authenticatedRequest("/traces/retention", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ log_retention: logRetention }),
  })
}

// GET /traces/usage/api-keys/{key_id} — owner or superuser.
export function getApiKeyUsage(
  keyId: string,
  range: UsageRange = {},
  includeHourly = false
): Promise<UsageAnalytics> {
  return authenticatedRequest<UsageAnalytics>(
    `/traces/usage/api-keys/${keyId}${buildUsageRangeQuery(range, includeHourly)}`
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
  range: UsageRange = {},
  includeHourly = false
): Promise<UsageAnalytics> {
  return authenticatedRequest<UsageAnalytics>(
    `/traces/usage/users/${userId}${buildUsageRangeQuery(range, includeHourly)}`
  )
}

// GET /traces/usage/me — authenticated user's own account-wide usage.
export function getMyUsage(
  range: UsageRange = {},
  includeHourly = false
): Promise<UsageAnalytics> {
  return authenticatedRequest<UsageAnalytics>(
    `/traces/usage/me${buildUsageRangeQuery(range, includeHourly)}`
  )
}

function buildUsageRangeQuery(range: UsageRange, includeHourly = false) {
  const params = new URLSearchParams()
  if (range.from) params.set("from", range.from)
  if (range.to) params.set("to", range.to)
  if (includeHourly) params.set("include_hourly", "true")
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
  request_id?: string
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
  options: { page?: number; pageSize?: number; requestId?: string } = {}
): Promise<MessagesPage> {
  const params = new URLSearchParams()
  if (options.page !== undefined) params.set("page", String(options.page))
  if (options.pageSize !== undefined)
    params.set("page_size", String(options.pageSize))
  if (options.requestId) params.set("request_id", options.requestId)
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

// --- Usage credits (decimal-string amounts; arithmetic lives in lib/credits.ts) ---

export type CreditBalance = {
  remaining_credits: string
  reserved_credits: string
  available_credits: string
}

export type CreditEntry = {
  id: string
  credits: string
  remaining_credits: string
  usage_id: string | null
  actor_id: string | null
  reason: string
  created_at: string
}

export type CreditHistoryPage = {
  items: CreditEntry[]
  page: number
  page_size: number
  total: number
}

export type CreditUsage = {
  id: string
  request_id: string
  user_id: string
  provider_id: string
  provider_model_id: string
  api_key_id: string
  rate_id: string
  tokens_per_credit: string
  max_request_tokens: number
  reserved_credits: string
  charged_credits: string
  input_tokens: number | null
  output_tokens: number | null
  provider_request_id: string | null
  status: string
  reason: string | null
  resolved_by: string | null
  created_at: string
  updated_at: string
}

export type CreditUsagePage = {
  items: CreditUsage[]
  page: number
  page_size: number
  total: number
}

export type CreditUsageStatusFilter =
  | "reserved"
  | "dispatched"
  | "usage_recorded"
  | "needs_review"
  | "settled"
  | "released"

export type CreditAddition = {
  credits: string
  idempotency_key: string
  reason: string
}

export type ModelCreditRate = {
  id: string
  provider_model_id: string
  version: number
  tokens_per_credit: string
  max_request_tokens: number | null
  created_at: string
}

export type ModelRateUpdate = {
  tokens_per_credit: string
  max_request_tokens?: number | null
}

export type UsageResolution = {
  action: "settle" | "release"
  input_tokens?: number
  output_tokens?: number
  reason: string
}

export type CreditPage = { page?: number; pageSize?: number }

function creditPageQuery(page?: number, pageSize?: number): string {
  const params = new URLSearchParams()
  if (page !== undefined) params.set("page", String(page))
  if (pageSize !== undefined) params.set("page_size", String(pageSize))
  const query = params.toString()
  return query ? `?${query}` : ""
}

export function getMyCredits(): Promise<CreditBalance> {
  return authenticatedRequest<CreditBalance>("/credits/me")
}

export function listMyCreditHistory(
  options: CreditPage = {}
): Promise<CreditHistoryPage> {
  return authenticatedRequest<CreditHistoryPage>(
    `/credits/me/history${creditPageQuery(options.page, options.pageSize)}`
  )
}

export function listMyCreditUsage(
  options: CreditPage = {}
): Promise<CreditUsagePage> {
  return authenticatedRequest<CreditUsagePage>(
    `/credits/me/usage${creditPageQuery(options.page, options.pageSize)}`
  )
}

export function getUserCredits(userId: string): Promise<CreditBalance> {
  return authenticatedRequest<CreditBalance>(`/credits/users/${userId}`)
}

export function listUserCreditHistory(
  userId: string,
  options: CreditPage = {}
): Promise<CreditHistoryPage> {
  return authenticatedRequest<CreditHistoryPage>(
    `/credits/users/${userId}/history${creditPageQuery(options.page, options.pageSize)}`
  )
}

export function addUserCredits(
  userId: string,
  input: CreditAddition
): Promise<CreditEntry> {
  return authenticatedRequest<CreditEntry>(`/credits/users/${userId}/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
}

export function getProviderCredits(providerId: string): Promise<CreditBalance> {
  return authenticatedRequest<CreditBalance>(`/provider/${providerId}/credits`)
}

export function listProviderCreditHistory(
  providerId: string,
  options: CreditPage = {}
): Promise<CreditHistoryPage> {
  return authenticatedRequest<CreditHistoryPage>(
    `/provider/${providerId}/credits/history${creditPageQuery(options.page, options.pageSize)}`
  )
}

export function addProviderCredits(
  providerId: string,
  input: CreditAddition
): Promise<CreditEntry> {
  return authenticatedRequest<CreditEntry>(
    `/provider/${providerId}/credits/add`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  )
}

export function getModelCreditRate(modelId: string): Promise<ModelCreditRate> {
  return authenticatedRequest<ModelCreditRate>(
    `/provider/models/${modelId}/credit-rate`
  )
}

export function setModelCreditRate(
  modelId: string,
  input: ModelRateUpdate
): Promise<ModelCreditRate> {
  return authenticatedRequest<ModelCreditRate>(
    `/provider/models/${modelId}/credit-rate`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  )
}

export type CreditUsageFilters = {
  page?: number
  pageSize?: number
  status?: CreditUsageStatusFilter
  userId?: string
}

export function listCreditUsage(
  options: CreditUsageFilters = {}
): Promise<CreditUsagePage> {
  const params = new URLSearchParams()
  if (options.page !== undefined) params.set("page", String(options.page))
  if (options.pageSize !== undefined)
    params.set("page_size", String(options.pageSize))
  if (options.status) params.set("status", options.status)
  if (options.userId?.trim()) params.set("user_id", options.userId.trim())
  const query = params.toString()
  return authenticatedRequest<CreditUsagePage>(
    `/credits/usage${query ? `?${query}` : ""}`
  )
}

export function resolveCreditUsage(
  usageId: string,
  input: UsageResolution
): Promise<CreditUsage> {
  return authenticatedRequest<CreditUsage>(
    `/credits/usage/${usageId}/resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  )
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

// --- Fixed-credit coupons ---
export interface Coupon {
  id: string
  code: string
  name: string
  credits: string
  enabled: boolean
  starts_at: string | null
  expires_at: string | null
  max_redemptions: number | null
  per_user_limit: number
  redemption_count: number
  created_by: string
  created_at: string
  updated_at: string
}

export interface CouponCreation {
  code: string
  name: string
  credits: string
  enabled: boolean
  starts_at: string | null
  expires_at: string | null
  max_redemptions: number | null
  per_user_limit: number
}

export interface CouponRedemption {
  id: string
  coupon_id: string
  code: string
  user_id: string
  credits: string
  created_at: string
  credit_entry: CreditEntry
}

export interface CouponPage<T> {
  items: T[]
  page: number
  page_size: number
  total: number
}

export function redeemCoupon(code: string, idempotencyKey: string) {
  return authenticatedRequest<CouponRedemption>("/coupons/redeem", {
    method: "POST",
    body: JSON.stringify({ code, idempotency_key: idempotencyKey }),
  })
}

export function listCoupons(page = 1) {
  return authenticatedRequest<CouponPage<Coupon>>(
    `/coupons${creditPageQuery(page, 20)}`
  )
}

export function createCoupon(data: CouponCreation) {
  return authenticatedRequest<Coupon>("/coupons", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export function updateCoupon(
  id: string,
  data: { name?: string; enabled?: boolean }
) {
  return authenticatedRequest<Coupon>(`/coupons/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  })
}

export function listCouponRedemptions(page = 1, couponId?: string) {
  const path = couponId
    ? `/coupons/${encodeURIComponent(couponId)}/redemptions`
    : "/coupons/me/redemptions"
  return authenticatedRequest<CouponPage<CouponRedemption>>(
    `${path}${creditPageQuery(page, 20)}`
  )
}

export type SupportCategory =
  "billing" | "api_keys" | "model_routing" | "latency" | "account" | "other"

export type SupportPriority = "low" | "normal" | "high" | "urgent"
export type SupportStatus = "open" | "in_progress" | "resolved" | "closed"

export type SupportTicketItem = {
  id: string
  user_id: string
  user_email: string | null
  subject: string
  category: SupportCategory
  priority: SupportPriority
  status: SupportStatus
  message_count: number
  last_message_at: string | null
  created_at: string
  updated_at: string
}

export type SupportTicketMessageItem = {
  id: string
  ticket_id: string
  sender_id: string
  sender_role: "user" | "superuser"
  sender_email: string | null
  message: string
  created_at: string
}

export type SupportTicketDetail = SupportTicketItem & {
  messages: SupportTicketMessageItem[]
}

export type SupportTicketList = {
  items: SupportTicketItem[]
  total: number
  page: number
  page_size: number
}

export type SupportStats = {
  total: number
  open: number
  in_progress: number
  resolved: number
  closed: number
}

export function createSupportTicket(data: {
  subject: string
  category: SupportCategory
  priority?: SupportPriority
  message: string
}): Promise<SupportTicketItem> {
  return authenticatedRequest<SupportTicketItem>("/support/tickets", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export function listSupportTickets(params?: {
  page?: number
  page_size?: number
  status?: string
  category?: string
  priority?: string
  search?: string
}): Promise<SupportTicketList> {
  const query = new URLSearchParams()
  if (params?.page) query.set("page", String(params.page))
  if (params?.page_size) query.set("page_size", String(params.page_size))
  if (params?.status) query.set("status", params.status)
  if (params?.category) query.set("category", params.category)
  if (params?.priority) query.set("priority", params.priority)
  if (params?.search) query.set("search", params.search)
  const qs = query.toString()
  return authenticatedRequest<SupportTicketList>(
    `/support/tickets${qs ? `?${qs}` : ""}`
  )
}

export function getSupportTicket(
  ticketId: string
): Promise<SupportTicketDetail> {
  return authenticatedRequest<SupportTicketDetail>(
    `/support/tickets/${encodeURIComponent(ticketId)}`
  )
}

export function addSupportTicketMessage(
  ticketId: string,
  message: string
): Promise<SupportTicketMessageItem> {
  return authenticatedRequest<SupportTicketMessageItem>(
    `/support/tickets/${encodeURIComponent(ticketId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ message }),
    }
  )
}

export function updateSupportTicketStatus(
  ticketId: string,
  status: SupportStatus
): Promise<SupportTicketItem> {
  return authenticatedRequest<SupportTicketItem>(
    `/support/tickets/${encodeURIComponent(ticketId)}/status`,
    {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }
  )
}

export function getSupportStats(): Promise<SupportStats> {
  return authenticatedRequest<SupportStats>("/support/stats")
}

export function getSignupSettings(): Promise<{ signups_enabled: boolean }> {
  return authenticatedRequest("/auth/signup-settings")
}

export function updateSignupSettings(
  signupsEnabled: boolean
): Promise<{ signups_enabled: boolean }> {
  return authenticatedRequest("/auth/signup-settings", {
    method: "PATCH",
    body: JSON.stringify({ signups_enabled: signupsEnabled }),
  })
}
