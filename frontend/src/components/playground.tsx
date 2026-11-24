"use client"

import * as React from "react"
import {
  Check,
  ChevronsUpDown,
  Code,
  Copy,
  Cpu,
  KeyRound,
  PanelRight,
  Plus,
  Search,
  X,
} from "lucide-react"
import { toast } from "sonner"
import type { ChatMessage } from "@/components/playground-message"
import { PlaygroundConversation } from "@/components/playground-conversation"
import {
  PlaygroundToolbar,
  PlaygroundComposer,
  PlaygroundEmptyState,
} from "@/components/playground-workspace"
import { PlaygroundSettings } from "@/components/playground-settings"

import {
  API_BASE_URL,
  createApiKey,
  getMyCredits,
  getPlaygroundApiKey,
  listModelGroups,
  listProviderModels,
  listProviders,
  listV1Models,
  setPlaygroundApiKey,
  type CreditBalance,
  type CurrentUser,
} from "@/lib/auth"
import {
  conversationHistory,
  requestSnippet,
  type ChatPayload,
} from "@/lib/playground-request"
import { readChatResponse, type RunSnapshot } from "@/lib/playground-stream"
import { formatCredits } from "@/lib/credits"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from "@/components/ui/sheet"
import { useIsMobile } from "@/hooks/use-mobile"
import type { InspectorProps } from "@/components/playground-inspector"
const PlaygroundInspector = React.lazy(
  () => import("@/components/playground-inspector")
)
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"

import { cn } from "cn"

type PlaygroundProps = {
  user: CurrentUser
}

type ModelChoice = {
  id: string
  label: string
  category: "model-group" | "provider-model" | "custom"
  detail?: string
  strategy?: string
  providerId?: string
  providerName?: string
}

export function PlaygroundContent({ user }: PlaygroundProps) {
  const isSuperuser = user.role === "superuser"

  // API Key management
  const [apiKey, setApiKey] = React.useState<string>(
    () => getPlaygroundApiKey() ?? ""
  )
  const [keyInput, setKeyInput] = React.useState("")
  const [keyDrawerOpen, setKeyDrawerOpen] = React.useState(false)
  const [isGeneratingKey, setIsGeneratingKey] = React.useState(false)

  // Models state
  const [models, setModels] = React.useState<ModelChoice[]>([])
  const [selectedModel, setSelectedModel] = React.useState<string>("")
  const [customModel, setCustomModel] = React.useState<string>("")
  const [customModelInput, setCustomModelInput] = React.useState<string>("")
  const [isCustomMode, setIsCustomMode] = React.useState<boolean>(false)
  const [isLoadingModels, setIsLoadingModels] = React.useState(true)

  // Model Picker Popover UX
  const [modelPickerOpen, setModelPickerOpen] = React.useState(false)
  const [modelSearchQuery, setModelSearchQuery] = React.useState("")
  const [categoryFilter, setCategoryFilter] = React.useState<
    "all" | "model-group" | "provider-model"
  >("all")

  // Conversation state
  const [systemPrompt, setSystemPrompt] = React.useState(
    "You are a helpful, precise AI assistant connected via Gateway."
  )
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [inputPrompt, setInputPrompt] = React.useState("")
  const [isGenerating, setIsGenerating] = React.useState(false)
  const abortControllerRef = React.useRef<AbortController | null>(null)
  const workspaceRef = React.useRef<HTMLDivElement | null>(null)
  const [conversationKey, setConversationKey] = React.useState(0)
  const [inspectorOpen, setInspectorOpen] = React.useState(false)
  const detailsButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const isMobile = useIsMobile()

  React.useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace) return
    const measure = () => {
      const viewport = window.visualViewport
      const bottom = viewport
        ? viewport.height + viewport.offsetTop
        : window.innerHeight
      const outerPadding =
        Number.parseFloat(
          getComputedStyle(workspace.parentElement!).paddingBottom
        ) || 16
      const inset = workspace.closest('[data-slot="sidebar-inset"]')
      const outerMargin = inset
        ? Number.parseFloat(getComputedStyle(inset).marginBottom) || 0
        : 0
      const height = Math.max(
        200,
        bottom -
          workspace.getBoundingClientRect().top -
          outerPadding -
          outerMargin
      )
      workspace.style.setProperty("--playground-height", `${height}px`)
      workspace.dataset.compact =
        viewport && viewport.height < window.innerHeight * 0.75
          ? "true"
          : "false"
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(workspace)
    window.addEventListener("resize", measure)
    window.visualViewport?.addEventListener("resize", measure)
    window.visualViewport?.addEventListener("scroll", measure)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
      window.visualViewport?.removeEventListener("resize", measure)
      window.visualViewport?.removeEventListener("scroll", measure)
    }
  }, [])
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)

  // Auto-resize modern composer textarea
  React.useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`
    }
  }, [inputPrompt])

  // Model parameters
  const [temperature, setTemperature] = React.useState<number>(0.7)
  const [maxTokens, setMaxTokens] = React.useState<number>(2048)
  const [topP, setTopP] = React.useState<number>(1.0)
  const [stream, setStream] = React.useState<boolean>(true)
  const [assistantFormat, setAssistantFormat] = React.useState<"md" | "text">("md")

  // Metrics state
  const [totalLatencyMs, setTotalLatencyMs] = React.useState<number | null>(
    null
  )
  const [tokensPerSec, setTokensPerSec] = React.useState<number | null>(null)
  const [finishReason, setFinishReason] = React.useState<string | null>(null)

  const [runDiagnostics, setRunDiagnostics] =
    React.useState<RunSnapshot | null>(null)

  React.useEffect(() => () => abortControllerRef.current?.abort(), [])

  // Code export & Inspector
  const [codeDrawerOpen, setCodeDrawerOpen] = React.useState(false)
  const [codeLang, setCodeLang] = React.useState<
    "curl" | "python" | "typescript"
  >("curl")
  const [exportDraft, setExportDraft] = React.useState(false)
  const [lastPayload, setLastPayload] = React.useState<ChatPayload | null>(null)
  const retryHistoryRef = React.useRef<ChatMessage[]>([])
  const sendingRef = React.useRef(false)
  const runIdRef = React.useRef(0)
  const [lastRawRequest, setLastRawRequest] = React.useState<string>("")
  const [lastRawResponse, setLastRawResponse] = React.useState<string>("")

  // Mobile parameters drawer toggle
  const [paramsDrawerOpen, setParamsDrawerOpen] = React.useState(false)

  // Credit balance state and auto-refresh
  const [creditBalance, setCreditBalance] =
    React.useState<CreditBalance | null>(null)
  const lastCreditsFetchRef = React.useRef<number>(0)

  const fetchCredits = React.useCallback(async () => {
    try {
      const balance = await getMyCredits()
      setCreditBalance(balance)
      lastCreditsFetchRef.current = Date.now()
    } catch {
      // Backend is authoritative; balance loading failure must not disable inference
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    getMyCredits()
      .then((balance) => {
        if (!cancelled) {
          setCreditBalance(balance)
          lastCreditsFetchRef.current = Date.now()
        }
      })
      .catch(() => {
        // Backend is authoritative; balance loading failure must not disable inference
      })
    return () => {
      cancelled = true
    }
  }, [])

  React.useEffect(() => {
    const FRESHNESS_MS = 15_000

    function handleFocusOrVisible() {
      if (document.visibilityState === "visible") {
        const now = Date.now()
        if (now - lastCreditsFetchRef.current > FRESHNESS_MS) {
          fetchCredits()
        }
      }
    }

    window.addEventListener("focus", handleFocusOrVisible)
    document.addEventListener("visibilitychange", handleFocusOrVisible)

    return () => {
      window.removeEventListener("focus", handleFocusOrVisible)
      document.removeEventListener("visibilitychange", handleFocusOrVisible)
    }
  }, [fetchCredits])

  // Load models on mount or when API key / role changes
  React.useEffect(() => {
    let cancelled = false

    async function fetchAvailableModels() {
      setIsLoadingModels(true)
      const choices: ModelChoice[] = []

      // 1. Fetch enabled Model Groups (Gateway models) for all authenticated users
      try {
        const groupList = await listModelGroups({
          isEnabled: true,
          pageSize: 100,
        })
        if (!cancelled && groupList.items) {
          for (const g of groupList.items) {
            const strategyLabel =
              g.routing_strategy === "priority"
                ? "Priority Failover"
                : g.routing_strategy === "weighted_round_robin"
                  ? "Weighted Round-Robin"
                  : "Round-Robin"
            choices.push({
              id: g.model_id,
              label: g.name,
              category: "model-group",
              strategy: g.routing_strategy,
              detail: isSuperuser
                ? `${strategyLabel} · ${g.member_count} member(s)`
                : undefined,
            })
          }
        }
      } catch {
        // continue
      }

      // 2. Superusers can additionally test direct provider models
      if (isSuperuser) {
        // Load providers & synced models for direct testing
        try {
          const providers = await listProviders()
          for (const p of providers.filter((p) => p.is_enabled)) {
            try {
              const pModels = await listProviderModels(p.id)
              for (const pm of pModels.filter((m) => m.is_available)) {
                const directId = `${p.aliases}/${pm.model_name}`
                choices.push({
                  id: directId,
                  label: directId,
                  category: "provider-model",
                  detail: `${p.name} · ${p.protocol}`,
                  providerId: p.id,
                  providerName: p.name,
                })
              }
            } catch {
              // skip failed provider
            }
          }
        } catch {
          // ignore
        }
      }

      // 3. Query /v1/models using API key (works for both user and superuser; only gateway models returned)
      if (apiKey) {
        try {
          const v1List = await listV1Models(apiKey)
          if (!cancelled && v1List.data) {
            for (const item of v1List.data) {
              if (!choices.some((c) => c.id === item.id)) {
                choices.push({
                  id: item.id,
                  label: item.id,
                  category: "model-group",
                  detail: isSuperuser ? "Gateway Model Group" : undefined,
                })
              }
            }
          }
        } catch {
          // ignore
        }
      }

      if (!cancelled) {
        setModels(choices)
        if (choices.length > 0) {
          setSelectedModel((current) => current || choices[0].id)
        }
        setIsLoadingModels(false)
      }
    }

    void fetchAvailableModels()

    return () => {
      cancelled = true
    }
  }, [apiKey, isSuperuser])

  // 1-Click Key Generator
  async function handleCreatePlaygroundKey() {
    setIsGeneratingKey(true)
    try {
      const created = await createApiKey(
        `Playground Key (${new Date().toLocaleDateString()})`
      )
      setPlaygroundApiKey(created.api_key)
      setApiKey(created.api_key)
      setKeyDrawerOpen(false)
      toast.success("Playground API key connected!")
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create API key."
      )
    } finally {
      setIsGeneratingKey(false)
    }
  }

  function handleSaveManualKey() {
    if (!keyInput.trim()) {
      toast.error("Please enter an API key.")
      return
    }
    const cleanKey = keyInput.trim()
    setPlaygroundApiKey(cleanKey)
    setApiKey(cleanKey)
    setKeyInput("")
    setKeyDrawerOpen(false)
    toast.success("API key saved for this session.")
  }

  function handleClearKey() {
    setApiKey("")
    setPlaygroundApiKey("")
    toast.info("Playground API key disconnected.")
  }

  // Active target model ID and label
  const activeModelId =
    selectedModel === "__custom__" ? customModel.trim() : selectedModel
  const activeModelChoice = models.find((m) => m.id === activeModelId)

  // Filtered models for combobox popover
  const filteredModels = React.useMemo(() => {
    return models.filter((m) => {
      const matchesCategory =
        categoryFilter === "all" || m.category === categoryFilter
      const query = modelSearchQuery.toLowerCase().trim()
      const matchesQuery =
        !query ||
        m.id.toLowerCase().includes(query) ||
        m.label.toLowerCase().includes(query) ||
        (m.detail && m.detail.toLowerCase().includes(query))
      return matchesCategory && matchesQuery
    })
  }, [models, categoryFilter, modelSearchQuery])

  const groupsCount = React.useMemo(
    () => models.filter((m) => m.category === "model-group").length,
    [models]
  )
  const providersCount = React.useMemo(
    () => models.filter((m) => m.category === "provider-model").length,
    [models]
  )

  // Send request to /v1/chat/completions
  async function handleSendMessage(promptText?: string, retry = false) {
    const textToSend = promptText ?? inputPrompt
    if ((!retry && !textToSend.trim()) || sendingRef.current) return

    if (!apiKey) {
      setKeyDrawerOpen(true)
      toast.info("Connect an API key to test models.")
      return
    }

    if (!retry && !activeModelId) {
      toast.error("Select or enter a target model.")
      return
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: textToSend.trim(),
      timestamp: new Date(),
    }

    const assistantMessageId = crypto.randomUUID()
    const assistantPlaceholder: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      modelId: retry ? lastPayload?.model : activeModelId,
      content: "",
      timestamp: new Date(),
      isStreaming: true,
    }

    const newMessages = retry
      ? retryHistoryRef.current
      : [...messages, userMessage]
    retryHistoryRef.current = newMessages
    sendingRef.current = true
    const runId = ++runIdRef.current
    setMessages([...newMessages, assistantPlaceholder])
    setInputPrompt("")
    setIsGenerating(true)
    setRunDiagnostics(null)
    setTotalLatencyMs(null)
    setTokensPerSec(null)
    setFinishReason(null)

    // Build chat payload
    const formattedMessages: ChatPayload["messages"] = []
    if (systemPrompt.trim()) {
      formattedMessages.push({ role: "system", content: systemPrompt.trim() })
    }
    for (const m of conversationHistory(newMessages)) {
      formattedMessages.push({ role: m.role, content: m.content })
    }

    const payload: ChatPayload =
      retry && lastPayload
        ? lastPayload
        : {
            model: activeModelId,
            messages: formattedMessages,
            temperature,
            max_tokens: maxTokens,
            top_p: topP,
            stream,
          }

    const payloadJson = JSON.stringify(payload, null, 2)
    setLastPayload(JSON.parse(payloadJson) as ChatPayload)
    setLastRawRequest(payloadJson)
    setLastRawResponse("")

    const startTime = performance.now()
    let accumulatedContent = ""
    let accumulatedReasoning = ""

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const response = await fetch(`${API_BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey.trim(),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      if (runId !== runIdRef.current) return
      if (!response.ok) {
        setInputPrompt((value) => value || textToSend)

        let errMessage =
          response.status === 402
            ? "Not enough credits for this request. Check your available credits or choose a cheaper model."
            : `Error ${response.status}: ${response.statusText}`
        let errCode: string | undefined
        let errorAction: { label: string; href: string } | undefined

        try {
          const errData = await response.json()
          setLastRawResponse(
            JSON.stringify(errData, null, 2)
              .slice(-32_768)
              .replaceAll(apiKey.trim(), "[REDACTED]")
          )
          if (errData?.error?.message) {
            errMessage = errData.error.message
          } else if (errData?.detail) {
            errMessage =
              typeof errData.detail === "string"
                ? errData.detail
                : JSON.stringify(errData.detail)
          }
          if (errData?.error?.code) {
            errCode = errData.error.code
          }
        } catch {
          // ignore
        }

        if (response.status === 401) {
          errMessage =
            "Authentication failed: The API key is invalid or deactivated."
        } else if (response.status === 429) {
          errMessage =
            "Rate limit reached: The request exceeded the allowed rate of 60 requests per minute."
        } else if (
          response.status === 402 ||
          errCode === "insufficient_credits"
        ) {
          errorAction = {
            label: "View Credits",
            href: "/dashboard/credits",
          }
        } else if (response.status === 503) {
          if (
            errCode === "provider_credits_exhausted" ||
            errMessage.includes("Provider has insufficient available credits")
          ) {
            if (isSuperuser) {
              if (activeModelChoice?.providerId) {
                errorAction = {
                  label: `Manage ${activeModelChoice.providerName ?? "Provider"} credits`,
                  href: `/dashboard/providers/detail?id=${activeModelChoice.providerId}`,
                }
              } else {
                errorAction = {
                  label: "Manage Model Groups",
                  href: "/dashboard/model-groups",
                }
              }
            }
          } else if (
            errCode === "model_rate_missing" ||
            errMessage.includes("credit rate is not configured")
          ) {
            if (isSuperuser) {
              errMessage =
                "No credit rate is configured for this model. Requests cannot be admitted without an active rate."
              if (activeModelChoice?.providerId) {
                errorAction = {
                  label: `Configure ${activeModelChoice.providerName ?? "model"} rate`,
                  href: `/dashboard/providers/detail?id=${activeModelChoice.providerId}`,
                }
              } else {
                errorAction = {
                  label: "Manage Model Groups",
                  href: "/dashboard/model-groups",
                }
              }
            } else {
              errMessage =
                "This model cannot be dispatched because its credit rate is not configured. Please select another model."
            }
          } else if (
            errCode === "model_unavailable" ||
            errMessage.includes("Provider model is unavailable")
          ) {
            if (isSuperuser) {
              errMessage =
                "The provider model is marked as unavailable or disabled."
              if (activeModelChoice?.providerId) {
                errorAction = {
                  label: `Manage ${activeModelChoice.providerName ?? "Provider"}`,
                  href: `/dashboard/providers/detail?id=${activeModelChoice.providerId}`,
                }
              } else {
                errorAction = {
                  label: "Manage Providers",
                  href: "/dashboard/providers",
                }
              }
            } else {
              errMessage =
                "This model is currently unavailable from the provider. Please select another model."
            }
          } else if (
            errCode === "no_available_member" ||
            errMessage.includes("No eligible provider")
          ) {
            if (isSuperuser) {
              errMessage =
                "No eligible provider in the model group could serve this request (all members were disabled, missing rates, or exhausted credits)."
              errorAction = {
                label: "Manage Model Groups",
                href: "/dashboard/model-groups",
              }
            } else {
              errMessage =
                "No provider is currently available to serve this model group. Please choose another model."
            }
          }
        } else if (
          response.status === 400 &&
          (errCode === "output_limit_exceeded" ||
            errMessage.includes("Requested output exceeds"))
        ) {
          if (isSuperuser && activeModelChoice?.providerId) {
            errorAction = {
              label: `Check ${activeModelChoice.providerName ?? "model"} rate limits`,
              href: `/dashboard/providers/detail?id=${activeModelChoice.providerId}`,
            }
          }
        }

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: "",
                  runStatus: `Failed: ${errMessage}`,
                  isStreaming: false,
                  error: true,
                  errorAction,
                }
              : msg
          )
        )
        setFinishReason("error")
        void fetchCredits()
        return
      }

      const result = await readChatResponse(
        response,
        controller.signal,
        startTime,
        (snapshot) => {
          accumulatedContent = snapshot.content
          accumulatedReasoning = snapshot.reasoning
          if (runId !== runIdRef.current) return
          // Exclude the connected credential if an upstream response echoes it.
          setLastRawResponse(
            snapshot.raw.replaceAll(apiKey.trim(), "[REDACTED]")
          )
          setRunDiagnostics({ ...snapshot, raw: "", reasoning: "" })
          setFinishReason(snapshot.finishReason)
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? {
                    ...msg,
                    content: snapshot.content,
                    reasoning: snapshot.reasoning,
                    runStatus: snapshot.status,
                  }
                : msg
            )
          )
        }
      )
      if (runId !== runIdRef.current) return
      const totalDuration = Math.round(performance.now() - startTime)
      setTotalLatencyMs(totalDuration)
      setFinishReason(result.finishReason ?? result.status)
      // Provider output tokens / total request time, never event count.
      if (result.usage?.completionTokens != null && totalDuration > 0) {
        setTokensPerSec(
          Math.round(
            (result.usage.completionTokens / (totalDuration / 1000)) * 10
          ) / 10
        )
      }
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? {
                ...msg,
                isStreaming: false,
                latencyMs: totalDuration,
                tokens: result.usage?.completionTokens ?? undefined,
                includeInHistory: Boolean(result.content),
              }
            : msg
        )
      )
      void fetchCredits()
    } catch (err: unknown) {
      if (runId !== runIdRef.current) return
      if (controller.signal.aborted) {
        setFinishReason("cancelled")
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: accumulatedContent,
                  reasoning: accumulatedReasoning,
                  runStatus: "Stopped",
                  isStreaming: false,
                }
              : msg
          )
        )
      } else {
        setFinishReason("error")
        setInputPrompt((value) => value || textToSend)
        const errorMsg = err instanceof Error ? err.message : "Network error."
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: accumulatedContent,
                  reasoning: accumulatedReasoning,
                  runStatus: `Failed: ${errorMsg}`,
                  isStreaming: false,
                  error: true,
                }
              : msg
          )
        )
      }
      void fetchCredits()
    } finally {
      if (runId === runIdRef.current) {
        setTotalLatencyMs(Math.round(performance.now() - startTime))
        sendingRef.current = false
        setIsGenerating(false)
        abortControllerRef.current = null
      }
    }
  }

  function handleStopGeneration() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    void fetchCredits()
  }

  function handleClearChat() {
    handleStopGeneration()
    setConversationKey((value) => value + 1)
    ++runIdRef.current
    sendingRef.current = false
    setIsGenerating(false)
    setMessages([])
    setInputPrompt("")
    requestAnimationFrame(() => textareaRef.current?.focus())
    setRunDiagnostics(null)
    setTotalLatencyMs(null)
    setTokensPerSec(null)
    setFinishReason(null)
    setLastPayload(null)
    retryHistoryRef.current = []
    setLastRawRequest("")
    setLastRawResponse("")
    toast.info("Conversation cleared.")
  }

  // Dynamic code snippets
  function getCodeSnippet(): string {
    const draft: ChatPayload = {
      model: activeModelId || "your-model-id",
      messages: [
        ...(systemPrompt.trim()
          ? [{ role: "system" as const, content: systemPrompt.trim() }]
          : []),
        ...conversationHistory(messages),
        ...(inputPrompt.trim()
          ? [{ role: "user" as const, content: inputPrompt.trim() }]
          : []),
      ],
      temperature,
      max_tokens: maxTokens,
      top_p: topP,
      stream,
    }
    return requestSnippet(
      !exportDraft && lastPayload ? lastPayload : draft,
      codeLang,
      API_BASE_URL,
      window.location.origin
    )
  }

  const currentMessage = messages.at(-1)
  const runStatus =
    currentMessage?.role === "assistant"
      ? currentMessage.runStatus ||
        (isGenerating ? "Waiting for response…" : "Ready")
      : "Ready"
  const inspectorProps: InspectorProps = {
    status: runStatus,
    diagnostics: runDiagnostics,
    request: lastRawRequest,
    response: lastRawResponse,
    model: lastPayload?.model,
    latencyMs: totalLatencyMs,
    tokensPerSec,
    finishReason,
    onExport: () => {
      setExportDraft(false)
      setCodeDrawerOpen(true)
    },
  }
  const inspector = (
    <React.Suspense
      fallback={
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Loading run details…
        </p>
      }
    >
      <PlaygroundInspector {...inspectorProps} />
    </React.Suspense>
  )
  const modelPicker = (
    <Popover open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={modelPickerOpen}
          aria-label="Choose model"
          className="h-10 w-full max-w-sm min-w-0 justify-start gap-2"
        >
          <Cpu className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate text-left text-sm">
            {activeModelChoice
              ? activeModelChoice.label
              : activeModelId || "Select a model"}
          </span>

          {isSuperuser ? (
            activeModelChoice?.category === "model-group" ? (
              <Badge
                variant="secondary"
                className="h-4 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
              >
                {activeModelChoice.strategy === "priority"
                  ? "Priority"
                  : activeModelChoice.strategy === "weighted_round_robin"
                    ? "WRR"
                    : "Group"}
              </Badge>
            ) : activeModelChoice?.category === "provider-model" ? (
              <Badge
                variant="outline"
                className="h-4 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
              >
                Direct
              </Badge>
            ) : selectedModel === "__custom__" ? (
              <Badge
                variant="outline"
                className="h-4 px-1.5 py-0 text-[10px] font-normal text-primary"
              >
                Custom
              </Badge>
            ) : null
          ) : null}

          <ChevronsUpDown className="ml-0.5 size-3.5 shrink-0 text-muted-foreground opacity-60" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[min(380px,calc(100vw-2rem))] border-border p-0"
      >
        {/* Search Bar */}
        <div className="flex items-center border-b px-3 py-2">
          <Search className="mr-2 size-3.5 shrink-0 text-muted-foreground" />
          <Input
            aria-label="Search models"
            placeholder={
              isSuperuser ? "Search models or providers…" : "Search models…"
            }
            value={modelSearchQuery}
            onChange={(e) => setModelSearchQuery(e.target.value)}
            className="border-0 shadow-none"
            autoFocus
          />
          {modelSearchQuery ? (
            <button
              type="button"
              aria-label="Clear model search"
              onClick={() => setModelSearchQuery("")}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>

        {isSuperuser && (groupsCount > 0 || providersCount > 0) ? (
          <ToggleGroup
            type="single"
            value={categoryFilter}
            onValueChange={(value) => {
              if (value) setCategoryFilter(value as typeof categoryFilter)
            }}
            aria-label="Model category"
            className="w-full justify-start border-b px-2 py-2"
          >
            <ToggleGroupItem value="all" aria-label="All models">
              All ({models.length})
            </ToggleGroupItem>
            {groupsCount > 0 && (
              <ToggleGroupItem value="model-group" aria-label="Model groups">
                Groups ({groupsCount})
              </ToggleGroupItem>
            )}
            {providersCount > 0 && (
              <ToggleGroupItem
                value="provider-model"
                aria-label="Direct models"
              >
                Direct ({providersCount})
              </ToggleGroupItem>
            )}
          </ToggleGroup>
        ) : null}

        {/* Models List */}
        <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto p-1.5">
          {isLoadingModels ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              Discovering models…
            </div>
          ) : filteredModels.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              {models.length === 0 && !apiKey
                ? "Connect an API key to view gateway models."
                : "No matching models found."}
            </div>
          ) : (
            filteredModels.map((m) => {
              const isSelected = activeModelId === m.id
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setSelectedModel(m.id)
                    setModelPickerOpen(false)
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
                    isSelected
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-foreground hover:bg-muted"
                  )}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <Check
                      className={cn(
                        "size-3.5 shrink-0",
                        isSelected ? "text-primary opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex flex-col overflow-hidden">
                      <span className="truncate font-mono text-[11px] sm:text-xs">
                        {m.label}
                      </span>
                      {m.detail ? (
                        <span className="truncate text-[10px] text-muted-foreground">
                          {m.detail}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {isSuperuser ? (
                    <Badge
                      variant={
                        m.category === "model-group" ? "secondary" : "outline"
                      }
                      className="shrink-0 px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                    >
                      {m.category === "model-group"
                        ? m.strategy === "priority"
                          ? "Priority"
                          : m.strategy === "weighted_round_robin"
                            ? "Weighted"
                            : "Round Robin"
                        : "Direct"}
                    </Badge>
                  ) : null}
                </button>
              )
            })
          )}
        </div>

        {/* Custom Model Route Entry (Superusers only) */}
        {isSuperuser ? (
          <div className="border-t bg-muted/10 p-2">
            {isCustomMode ? (
              <div className="flex items-center gap-1.5">
                <Input
                  value={customModelInput}
                  onChange={(e) => setCustomModelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customModelInput.trim()) {
                      setSelectedModel("__custom__")
                      setCustomModel(customModelInput.trim())
                      setModelPickerOpen(false)
                      setIsCustomMode(false)
                    }
                  }}
                  aria-label="Custom model route"
                  placeholder="Provider alias/model"
                  className="h-7 font-mono text-xs"
                  autoFocus
                />
                <Button
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    if (customModelInput.trim()) {
                      setSelectedModel("__custom__")
                      setCustomModel(customModelInput.trim())
                      setModelPickerOpen(false)
                      setIsCustomMode(false)
                    }
                  }}
                >
                  Apply
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-1.5 text-xs text-muted-foreground"
                  aria-label="Cancel custom model"
                  onClick={() => setIsCustomMode(false)}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsCustomMode(true)}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Plus className="size-3" />
                <span>Custom model route…</span>
              </button>
            )}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )

  return (
    <div
      ref={workspaceRef}
      data-playground-workspace
      className="group/workspace flex h-[var(--playground-height,calc(100dvh-6rem))] min-h-0 flex-none flex-col px-4 md:px-6 lg:px-8"
    >
      <PlaygroundToolbar
        modelPicker={modelPicker}
        keyConnected={Boolean(apiKey)}
        onKey={() => setKeyDrawerOpen(true)}
        onSettings={() => setParamsDrawerOpen(true)}
        onNew={handleClearChat}
        canClear={Boolean(messages.length || inputPrompt)}
      />
      <section
        aria-label="Conversation workspace"
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="relative flex min-h-0 flex-1 flex-col">
          {messages.length ? (
            <PlaygroundConversation
              conversationId={conversationKey}
              messages={messages}
              modelId={activeModelId}
              generating={isGenerating}
              canRetry={Boolean(lastPayload)}
              defaultFormat={assistantFormat}
              onRetry={() => void handleSendMessage(undefined, true)}
            />
          ) : (
            <PlaygroundEmptyState
              hasKey={Boolean(apiKey)}
              hasModel={Boolean(activeModelId)}
              onConnect={() => setKeyDrawerOpen(true)}
              onChooseModel={() => setModelPickerOpen(true)}
              onPrompt={(prompt) => {
                setInputPrompt(prompt)
                textareaRef.current?.focus()
              }}
            />
          )}
        </div>
        <div className="mx-auto w-full max-w-[840px] shrink-0 pt-2 pb-[max(.75rem,env(safe-area-inset-bottom))]">
          <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <a
              href="/dashboard/credits"
              className="shrink-0 underline-offset-4 hover:underline"
            >
              Available credits{" "}
              <span className="ml-1 text-foreground tabular-nums">
                {creditBalance
                  ? formatCredits(creditBalance.available_credits)
                  : "Unavailable"}
              </span>
            </a>
            <div className="flex min-w-0 items-center gap-2">
              <span
                role="status"
                aria-live="polite"
                title={runStatus}
                className={cn(
                  "max-w-40 truncate",
                  currentMessage?.error && "text-destructive"
                )}
              >
                {runStatus}
              </span>
              <Button
                ref={detailsButtonRef}
                variant="ghost"
                size="sm"
                aria-expanded={inspectorOpen}
                onClick={() => setInspectorOpen(true)}
              >
                <PanelRight data-icon="inline-start" />
                Run details
              </Button>
            </div>
          </div>
          <PlaygroundComposer
            ref={textareaRef}
            value={inputPrompt}
            onChange={setInputPrompt}
            generating={isGenerating}
            onSend={() => void handleSendMessage()}
            onStop={handleStopGeneration}
          />
        </div>
      </section>

      <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          showCloseButton={false}
          className={cn(
            "gap-0 overflow-hidden",
            isMobile
              ? "h-[85dvh] max-h-[calc(100dvh-1rem)] rounded-t-xl"
              : "w-full sm:max-w-md"
          )}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            detailsButtonRef.current?.focus()
          }}
        >
          <SheetHeader className="shrink-0 flex-row items-center justify-between border-b p-4">
            <div>
              <SheetTitle>Run details</SheetTitle>
              <SheetDescription className="sr-only">
                Inspect the last request, timing, and live response events.
              </SheetDescription>
            </div>
            <SheetClose asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close run details"
              >
                <X />
              </Button>
            </SheetClose>
          </SheetHeader>
          {inspectorOpen ? inspector : null}
        </SheetContent>
      </Sheet>

      {/* Existing configuration and export controls remain independent of inference. */}
      <PlaygroundSettings
        open={paramsDrawerOpen}
        onOpenChange={setParamsDrawerOpen}
        systemPrompt={systemPrompt}
        onSystemPromptChange={setSystemPrompt}
        temperature={temperature}
        onTemperatureChange={setTemperature}
        maxTokens={maxTokens}
        onMaxTokensChange={setMaxTokens}
        topP={topP}
        onTopPChange={setTopP}
        stream={stream}
        onStreamChange={setStream}
        assistantFormat={assistantFormat}
        onAssistantFormatChange={setAssistantFormat}
        onExport={() => {
          setExportDraft(true)
          setCodeDrawerOpen(true)
        }}
      />

      <Dialog open={keyDrawerOpen} onOpenChange={setKeyDrawerOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto p-0 sm:max-w-lg">
          <DialogHeader className="px-5 pt-5 pr-12">
            <DialogTitle className="flex items-center gap-2 text-sm sm:text-base">
              <KeyRound className="size-4 text-primary" />
              <span>Connect API key</span>
            </DialogTitle>
            <DialogDescription>
              Use an existing key or create one for this session.
            </DialogDescription>
          </DialogHeader>

          <div className="flex max-h-[65dvh] flex-col gap-5 overflow-y-auto px-5 pb-5">
            {apiKey ? (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span>Key connected for this session</span>
                <Button variant="outline" size="sm" onClick={handleClearKey}>
                  Disconnect
                </Button>
              </div>
            ) : null}
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Create a dedicated key to test models in this browser.
              </p>
              <Button
                onClick={handleCreatePlaygroundKey}
                disabled={isGeneratingKey}
              >
                <KeyRound data-icon="inline-start" />
                {isGeneratingKey ? "Creating key…" : "Create and connect key"}
              </Button>
            </div>
            <Separator />
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="manual-key">
                  Use an existing API key
                </FieldLabel>
                <Input
                  id="manual-key"
                  type="password"
                  autoComplete="off"
                  placeholder="Paste your key"
                  value={keyInput}
                  onChange={(event) => setKeyInput(event.target.value)}
                />
              </Field>
              <Field>
                <Button
                  variant="outline"
                  onClick={handleSaveManualKey}
                  disabled={!keyInput.trim()}
                >
                  Connect key
                </Button>
              </Field>
            </FieldGroup>
          </div>
          <DialogFooter className="border-t p-5">
            <p className="mr-auto text-xs text-muted-foreground">
              Your key stays in this browser session.
            </p>
            <DialogClose asChild>
              <Button variant="outline" size="sm">
                Done
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pop Dialog: Code Snippet Export (Well structured, no overflow, no overlap) */}
      <Dialog open={codeDrawerOpen} onOpenChange={setCodeDrawerOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto p-0 sm:max-w-3xl">
          <DialogHeader className="px-5 pt-5 pr-12">
            <DialogTitle className="flex items-center gap-2 text-sm sm:text-base">
              <Code className="size-4 text-primary" />
              <span>
                {exportDraft || !lastPayload
                  ? "Draft next request"
                  : "Last dispatched request"}
              </span>
            </DialogTitle>
            <DialogDescription>
              Export the exact last-dispatched payload or preview the next
              draft. Shareable snippets use YOUR_API_KEY.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 p-5 pt-0">
            {/* Toolbar: Language Tabs (Left) & Dedicated Copy Button (Right) */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5">
              <ToggleGroup
                type="single"
                value={codeLang}
                onValueChange={(value) => {
                  if (value) setCodeLang(value as typeof codeLang)
                }}
                aria-label="Code language"
              >
                <ToggleGroupItem value="curl" aria-label="cURL">
                  cURL
                </ToggleGroupItem>
                <ToggleGroupItem value="python" aria-label="Python">
                  Python
                </ToggleGroupItem>
                <ToggleGroupItem value="typescript" aria-label="JavaScript">
                  JavaScript
                </ToggleGroupItem>
              </ToggleGroup>

              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 px-3 text-xs"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(getCodeSnippet())
                    toast.success("Code copied to clipboard.")
                  } catch {
                    toast.error(
                      "Could not copy. Select the code and copy it manually."
                    )
                  }
                }}
              >
                <Copy data-icon="inline-start" />
                Copy code
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!lastPayload}
                onClick={() => setExportDraft(false)}
              >
                Last dispatched request
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExportDraft(true)}
              >
                Draft next request
              </Button>
            </div>
            {/* Well-Structured Code Container (Controlled overflow, no overlapping) */}
            <div className="relative overflow-hidden rounded-lg border border-border/80 bg-muted/40">
              <pre
                tabIndex={0}
                aria-label={`${codeLang} request code`}
                className="max-h-[380px] min-h-[160px] overflow-x-auto overflow-y-auto p-4 font-mono text-xs leading-relaxed whitespace-pre text-foreground select-all"
              >
                <code>{getCodeSnippet()}</code>
              </pre>
            </div>
          </div>

          <DialogFooter className="flex items-center justify-between border-t bg-muted/15 p-3 sm:justify-between">
            <span className="font-mono text-[11px] text-muted-foreground">
              Endpoint: /v1/chat/completions
            </span>
            <DialogClose asChild>
              <Button size="sm" variant="outline" className="h-8 text-xs">
                Close
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
