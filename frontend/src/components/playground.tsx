"use client"

import * as React from "react"
import {
  ArrowRight,
  Check,
  ChevronsUpDown,
  ChevronRight,
  Code,
  Copy,
  Cpu,
  KeyRound,
  PanelRight,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Square,
  Terminal,
  X,
} from "lucide-react"
import { toast } from "sonner"

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
import {
  InputGroup,
  InputGroupTextarea,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group"
import {
  Message,
  MessageHeader,
  MessageContent,
  MessageFooter,
} from "@/components/ui/message"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from "@/components/ui/message-scroller"
import { Field, FieldLabel } from "@/components/ui/field"
import { useIsMobile } from "@/hooks/use-mobile"
import type { InspectorProps } from "@/components/playground-inspector"
const PlaygroundInspector = React.lazy(
  () => import("@/components/playground-inspector")
)
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"

import { Textarea } from "@/components/ui/textarea"
import { cn } from "cn"

type PlaygroundProps = {
  user: CurrentUser
}

export type ChatMessage = {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  reasoning?: string
  timestamp: Date
  modelId?: string
  tokens?: number
  latencyMs?: number
  isStreaming?: boolean
  includeInHistory?: boolean
  runStatus?: string
  error?: boolean
  errorAction?: {
    label: string
    href: string
  }
}

function copyMessageContent(text: string) {
  void navigator.clipboard.writeText(text)
  toast.success("Copied to clipboard.")
}

const PlaygroundMessage = React.memo(function PlaygroundMessage({
  message,
  modelId,
  onRetry,
}: {
  message: ChatMessage
  modelId: string
  onRetry?: () => void
}) {
  const isUser = message.role === "user"
  return (
    <Message
      align={isUser ? "end" : "start"}
      role="article"
      aria-label={isUser ? "Your message" : "Assistant response"}
    >
      <MessageContent>
        <MessageHeader className="gap-3">
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {isUser ? "You" : message.modelId || modelId || "Assistant"}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={isUser ? "Copy your message" : "Copy answer"}
            disabled={!message.content}
            onClick={() => copyMessageContent(message.content)}
          >
            <Copy />
          </Button>
        </MessageHeader>
        {!isUser && message.reasoning?.trim() ? (
          <Collapsible className="min-w-0 rounded-lg border bg-muted/20">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="group h-auto min-h-10 w-full justify-start gap-2 px-3 py-2 text-muted-foreground"
              >
                <ChevronRight className="transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none" />
                <Sparkles />
                <span>
                  {message.isStreaming && message.runStatus === "Thinking"
                    ? "Thinking…"
                    : "Thinking"}
                </span>
                <span className="ml-auto text-xs font-normal">
                  Provider reasoning
                </span>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="border-t px-3 py-3">
                <p className="mb-2 text-xs text-muted-foreground">
                  Reasoning text returned by the provider, separate from the
                  answer.
                </p>
                <div
                  role="region"
                  aria-label="Provider reasoning"
                  tabIndex={0}
                  className="max-h-72 overflow-y-auto rounded-sm text-sm leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {message.reasoning}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
        {message.content ? (
          <Bubble
            align={isUser ? "end" : "start"}
            variant={message.error ? "destructive" : isUser ? "muted" : "ghost"}
          >
            <BubbleContent className="[overflow-wrap:anywhere] whitespace-pre-wrap">
              {message.content}
            </BubbleContent>
          </Bubble>
        ) : null}
        <MessageFooter className="flex-col items-start gap-2">
          {message.runStatus || (message.isStreaming && !message.content) ? (
            <p
              className={cn(
                "text-xs [overflow-wrap:anywhere]",
                message.error && "text-destructive"
              )}
            >
              {message.runStatus || "Waiting for response…"}
            </p>
          ) : null}
          {onRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry exact request
            </Button>
          ) : null}
          {message.runStatus === "Stopped" ||
          (message.error && message.content) ? (
            <p>Partial answer excluded from follow-up history.</p>
          ) : null}
          {message.errorAction ? (
            <a
              href={message.errorAction.href}
              className="inline-flex items-center gap-1 underline underline-offset-4"
            >
              {message.errorAction.label}
              <ArrowRight className="size-4" />
            </a>
          ) : null}
        </MessageFooter>
      </MessageContent>
    </Message>
  )
})

type ModelChoice = {
  id: string
  label: string
  category: "model-group" | "provider-model" | "custom"
  detail?: string
  strategy?: string
  providerId?: string
  providerName?: string
}

const STARTER_PROMPTS = [
  "Explain the difference between SSE and WebSockets in simple terms.",
  "Write a Python function with type hints to calculate exponential backoff.",
  "What are the best practices for designing low-latency LLM gateway systems?",
  "Summarize the role of prompt caching in optimizing inference cost.",
]

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
  const [showSystemPrompt, setShowSystemPrompt] = React.useState(false)
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [inputPrompt, setInputPrompt] = React.useState("")
  const [isGenerating, setIsGenerating] = React.useState(false)
  const abortControllerRef = React.useRef<AbortController | null>(null)
  const workspaceRef = React.useRef<HTMLDivElement | null>(null)
  const [conversationKey, setConversationKey] = React.useState(0)
  const [inspectorOpen, setInspectorOpen] = React.useState(false)
  const [canSplit, setCanSplit] = React.useState(false)
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
      setCanSplit(workspace.clientWidth >= 1008)
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
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`
    }
  }, [inputPrompt])

  // Model parameters
  const [temperature, setTemperature] = React.useState<number>(0.7)
  const [maxTokens, setMaxTokens] = React.useState<number>(2048)
  const [topP, setTopP] = React.useState<number>(1.0)
  const [stream, setStream] = React.useState<boolean>(true)

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

        let errMessage = `Error ${response.status}: ${response.statusText}`
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
          errMessage =
            "Insufficient available credits. This request requires reserving its maximum token allowance up front, which exceeds your available credit balance."
          errorAction = {
            label: "View Credits balance",
            href: "/dashboard/credits",
          }
        } else if (response.status === 503) {
          if (
            errCode === "provider_credits_exhausted" ||
            errMessage.includes("Provider has insufficient available credits")
          ) {
            if (isSuperuser) {
              errMessage =
                "The upstream provider balance is insufficient to fund this request's credit reservation."
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
            } else {
              errMessage =
                "The provider for this model has temporarily exhausted its credit balance. Please select another model or try again later."
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
          errMessage = `Requested output (${maxTokens} tokens) exceeds the model's configured limit. Open the Parameters dialog to lower Max Output Tokens and retry.`
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
      API_BASE_URL
    )
  }

  // Parameters Content (Shared between the desktop dialog and mobile dialog)
  const ParametersContent = (
    <div className="space-y-4 p-4 text-xs">
      {/* Temperature */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label
            htmlFor="param-temp"
            className="cursor-pointer text-xs font-medium text-foreground"
          >
            Temperature
          </Label>
          <span className="font-mono text-xs font-semibold text-foreground tabular-nums">
            {temperature.toFixed(2)}
          </span>
        </div>
        <Slider
          id="param-temp"
          value={[temperature]}
          min={0}
          max={2}
          step={0.05}
          onValueChange={([val]) => setTemperature(val)}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground/70">
          <span>Precise (0.0)</span>
          <span>Creative (2.0)</span>
        </div>
      </div>

      {/* Max Output Tokens */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label
            htmlFor="param-max-tokens"
            className="cursor-pointer text-xs font-medium text-foreground"
          >
            Max Output Tokens
          </Label>
          <span className="font-mono text-xs font-semibold text-foreground tabular-nums">
            {maxTokens.toLocaleString()}
          </span>
        </div>
        <Slider
          id="param-max-tokens"
          value={[maxTokens]}
          min={256}
          max={8192}
          step={256}
          onValueChange={([val]) => setMaxTokens(val)}
        />
        <div className="flex justify-between font-mono text-[10px] text-muted-foreground/70">
          <span>256</span>
          <span>2,048</span>
          <span>4,096</span>
          <span>8,192</span>
        </div>
      </div>

      {/* Top P */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label
            htmlFor="param-top-p"
            className="cursor-pointer text-xs font-medium text-foreground"
          >
            Top P (Nucleus)
          </Label>
          <span className="font-mono text-xs font-semibold text-foreground tabular-nums">
            {topP.toFixed(2)}
          </span>
        </div>
        <Slider
          id="param-top-p"
          value={[topP]}
          min={0}
          max={1}
          step={0.05}
          onValueChange={([val]) => setTopP(val)}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground/70">
          <span>Focused (0.0)</span>
          <span>Broad (1.0)</span>
        </div>
      </div>

      {/* Stream toggle */}
      <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5">
        <div className="space-y-0.5">
          <Label
            htmlFor="param-stream"
            className="cursor-pointer text-xs font-medium text-foreground"
          >
            Stream Output
          </Label>
          <p className="text-[10px] text-muted-foreground">
            Server-Sent Events (SSE) chunks
          </p>
        </div>
        <Checkbox
          id="param-stream"
          checked={stream}
          onCheckedChange={(checked) => setStream(Boolean(checked))}
        />
      </div>
    </div>
  )

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
  const detailsButton = (
    <Button
      ref={detailsButtonRef}
      variant="outline"
      size="sm"
      aria-label="Run details"
      aria-expanded={inspectorOpen}
      onClick={() => setInspectorOpen((value) => !value)}
    >
      <PanelRight data-icon="inline-start" />
      <span className="hidden sm:inline">Run details</span>
      <span className="sm:hidden">Details</span>
    </Button>
  )

  const newConversationButton = (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleClearChat}
      disabled={!messages.length && !inputPrompt}
    >
      <Plus data-icon="inline-start" />
      <span className="hidden sm:inline">New conversation</span>
      <span className="sm:hidden">New</span>
    </Button>
  )

  const instructionsButton = (
    <Button
      variant={showSystemPrompt ? "secondary" : "ghost"}
      size="sm"
      aria-expanded={showSystemPrompt}
      onClick={() => setShowSystemPrompt((value) => !value)}
    >
      <Terminal data-icon="inline-start" />
      Instructions
    </Button>
  )

  const keyButton = (
    <Button variant="ghost" size="sm" onClick={() => setKeyDrawerOpen(true)}>
      <KeyRound data-icon="inline-start" />
      {apiKey ? "Key connected" : "Connect key"}
    </Button>
  )

  const availableCreditsLink = (
    <a
      href="/dashboard/credits"
      className="text-xs text-muted-foreground underline-offset-4 hover:underline"
    >
      Available credits{" "}
      <span className="ml-1 font-medium text-foreground tabular-nums">
        {creditBalance
          ? formatCredits(creditBalance.available_credits)
          : "Unavailable"}
      </span>
    </a>
  )

  return (
    <div
      ref={workspaceRef}
      className="group/workspace flex h-[var(--playground-height,calc(100dvh-6rem))] min-h-0 flex-none flex-col gap-3 px-4 lg:px-6"
      data-playground-workspace
    >
      <div className="flex shrink-0 flex-col gap-2.5 group-data-[compact=true]/workspace:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <div className="max-w-full min-w-0 flex-[1_1_14rem]">
            <Popover open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={modelPickerOpen}
                  aria-label="Choose model"
                  className="h-10 w-full min-w-0 justify-start gap-2 font-normal"
                >
                  <Cpu className="size-4 shrink-0 text-primary" />
                  <span className="truncate text-xs font-medium text-foreground sm:max-w-[240px] sm:text-sm">
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
                          : activeModelChoice.strategy ===
                              "weighted_round_robin"
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
                  <input
                    aria-label="Search models"
                    placeholder={
                      isSuperuser
                        ? "Search models or providers…"
                        : "Search models…"
                    }
                    value={modelSearchQuery}
                    onChange={(e) => setModelSearchQuery(e.target.value)}
                    className="w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
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

                {/* Category Filter Pills (Superusers only) */}
                {isSuperuser && (groupsCount > 0 || providersCount > 0) ? (
                  <div className="flex items-center gap-1 border-b bg-muted/20 px-2 py-1.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setCategoryFilter("all")}
                      className={cn(
                        "rounded-md px-2 py-0.5 font-medium transition-colors",
                        categoryFilter === "all"
                          ? "bg-background text-foreground shadow-2xs"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      All ({models.length})
                    </button>
                    {groupsCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => setCategoryFilter("model-group")}
                        className={cn(
                          "rounded-md px-2 py-0.5 font-medium transition-colors",
                          categoryFilter === "model-group"
                            ? "bg-background text-foreground shadow-2xs"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        Groups ({groupsCount})
                      </button>
                    ) : null}
                    {providersCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => setCategoryFilter("provider-model")}
                        className={cn(
                          "rounded-md px-2 py-0.5 font-medium transition-colors",
                          categoryFilter === "provider-model"
                            ? "bg-background text-foreground shadow-2xs"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        Direct ({providersCount})
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {/* Models List */}
                <div className="max-h-72 space-y-0.5 overflow-y-auto p-1.5">
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
                                isSelected
                                  ? "text-primary opacity-100"
                                  : "opacity-0"
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
                                m.category === "model-group"
                                  ? "secondary"
                                  : "outline"
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
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setParamsDrawerOpen(true)}
            >
              <SlidersHorizontal data-icon="inline-start" />
              Parameters
            </Button>
            {instructionsButton}
            {keyButton}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          {availableCreditsLink}
          <div className="flex flex-wrap items-center gap-1.5">
            {newConversationButton}
            {detailsButton}
          </div>
        </div>
      </div>
      <div
        className={cn(
          "grid min-h-0 flex-1 overflow-hidden rounded-xl border bg-background",
          canSplit && inspectorOpen && "grid-cols-[minmax(0,1fr)_340px]"
        )}
      >
        <section
          aria-label="Conversation workspace"
          className="flex min-h-0 min-w-0 flex-col"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
            <h2 className="text-sm font-medium">Conversation</h2>
            <p
              role="status"
              aria-live="polite"
              className={cn(
                "max-w-[65%] truncate text-xs",
                currentMessage?.error
                  ? "font-mono text-destructive"
                  : "text-muted-foreground"
              )}
              title={runStatus}
            >
              {runStatus}
            </p>
          </div>
          {showSystemPrompt ? (
            <div className="shrink-0 border-b bg-muted/30 p-3">
              <Field className="gap-2">
                <FieldLabel htmlFor="system-instructions">
                  System instructions
                </FieldLabel>
                <Textarea
                  id="system-instructions"
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  className="max-h-28 min-h-16 resize-y"
                />
              </Field>
            </div>
          ) : null}
          <div className="relative flex min-h-0 flex-1 flex-col">
            {messages.length ? (
              <MessageScrollerProvider key={conversationKey} autoScroll>
                <MessageScroller>
                  <MessageScrollerViewport
                    aria-label="Conversation messages"
                    role="region"
                    tabIndex={0}
                  >
                    <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-6 px-4 py-5 sm:px-6">
                      {messages.map((message) => (
                        <MessageScrollerItem
                          key={message.id}
                          messageId={message.id}
                          scrollAnchor={message.role === "user"}
                        >
                          <PlaygroundMessage
                            message={message}
                            modelId={activeModelId}
                            onRetry={
                              !isGenerating &&
                              !message.isStreaming &&
                              (message.error ||
                                message.runStatus === "Stopped") &&
                              message.id === currentMessage?.id &&
                              lastPayload
                                ? () => void handleSendMessage(undefined, true)
                                : undefined
                            }
                          />
                        </MessageScrollerItem>
                      ))}
                    </MessageScrollerContent>
                  </MessageScrollerViewport>
                  <MessageScrollerButton aria-label="Latest output" />
                </MessageScroller>
              </MessageScrollerProvider>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6">
                <div className="mx-auto flex min-h-full max-w-lg flex-col justify-center gap-5 py-6">
                  <div className="flex flex-col gap-2">
                    <h2 className="text-2xl font-medium tracking-tight">
                      Start with a prompt.
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {!apiKey
                        ? "Connect a key, choose a model, and send your first message."
                        : !activeModelId
                          ? "Choose a model to start a conversation."
                          : "Send a message. Watch the answer here and inspect the run when you need to."}
                    </p>
                  </div>
                  {!apiKey ? (
                    <Button
                      className="self-start"
                      onClick={() => setKeyDrawerOpen(true)}
                    >
                      <KeyRound data-icon="inline-start" />
                      Connect key
                    </Button>
                  ) : !activeModelId ? (
                    <Button
                      className="self-start"
                      onClick={() => setModelPickerOpen(true)}
                    >
                      Choose model
                    </Button>
                  ) : null}
                  <div className="flex flex-col gap-2">
                    <p className="text-xs text-muted-foreground">
                      Try a prompt
                    </p>
                    {STARTER_PROMPTS.slice(0, 2).map((prompt) => (
                      <Button
                        key={prompt}
                        variant="outline"
                        className="h-auto justify-start px-3 py-3 text-left whitespace-normal"
                        onClick={() => {
                          setInputPrompt(prompt)
                          textareaRef.current?.focus()
                        }}
                      >
                        {prompt}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <form
            className="flex shrink-0 flex-col gap-2 border-t p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:p-4"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSendMessage()
            }}
          >
            <Field className="gap-2">
              <FieldLabel htmlFor="playground-prompt" className="sr-only">
                Message
              </FieldLabel>
              <InputGroup className="rounded-xl">
                <InputGroupTextarea
                  id="playground-prompt"
                  ref={textareaRef}
                  value={inputPrompt}
                  onChange={(event) => setInputPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault()
                      void handleSendMessage()
                    }
                  }}
                  rows={2}
                  placeholder="Message the model…"
                  className="max-h-[min(9rem,24dvh)] min-h-16"
                  aria-describedby="composer-help"
                />
                <InputGroupAddon align="block-end" className="gap-2">
                  <InputGroupButton
                    size="sm"
                    aria-label="Adjust model parameters"
                    onClick={() => setParamsDrawerOpen(true)}
                  >
                    <SlidersHorizontal />
                    <span className="hidden sm:inline">Parameters</span>
                  </InputGroupButton>
                  <p
                    id="composer-help"
                    className="min-w-0 flex-1 truncate text-xs font-normal text-muted-foreground"
                  >
                    <span className="hidden sm:inline">
                      Enter to send · Shift+Enter for a new line
                    </span>
                    <span className="sm:hidden">Enter to send</span>
                  </p>
                  <InputGroupButton
                    size="sm"
                    aria-label="View request code"
                    aria-haspopup="dialog"
                    onClick={() => {
                      setExportDraft(
                        Boolean(inputPrompt.trim()) || !lastPayload
                      )
                      setCodeDrawerOpen(true)
                    }}
                  >
                    <Code data-icon="inline-start" />
                    Code
                  </InputGroupButton>
                  {isGenerating ? (
                    <InputGroupButton
                      size="icon-sm"
                      variant="default"
                      aria-label="Stop generation"
                      onClick={handleStopGeneration}
                    >
                      <Square />
                    </InputGroupButton>
                  ) : (
                    <InputGroupButton
                      size="icon-sm"
                      type="submit"
                      variant="default"
                      disabled={!inputPrompt.trim()}
                      aria-label="Send message"
                    >
                      <Send />
                    </InputGroupButton>
                  )}
                </InputGroupAddon>
              </InputGroup>
            </Field>
          </form>
        </section>
        {canSplit && inspectorOpen ? (
          <aside
            aria-label="Run inspector"
            className="flex min-h-0 min-w-0 flex-col border-l bg-muted/10"
          >
            <div className="flex shrink-0 items-center justify-between p-4">
              <h2 className="text-sm font-medium">Run inspector</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setInspectorOpen(false)
                  detailsButtonRef.current?.focus()
                }}
              >
                Hide
              </Button>
            </div>
            {inspector}
          </aside>
        ) : null}
      </div>

      <Sheet open={!canSplit && inspectorOpen} onOpenChange={setInspectorOpen}>
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
              <SheetTitle>Run inspector</SheetTitle>
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
      <Dialog open={paramsDrawerOpen} onOpenChange={setParamsDrawerOpen}>
        <DialogContent className="w-[92vw] max-w-md overflow-hidden border-border p-0 shadow-2xl sm:max-w-lg">
          <DialogHeader className="p-4 pb-3">
            <DialogTitle className="flex items-center gap-2 text-sm sm:text-base">
              <SlidersHorizontal className="size-4 text-primary" />
              <span>Parameters</span>
            </DialogTitle>
            <DialogDescription>
              Adjust the next request. Changes do not send a request.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            {ParametersContent}
          </div>
          <DialogFooter className="flex items-center justify-between border-t bg-muted/15 p-3 sm:justify-between">
            <DialogClose asChild>
              <Button variant="outline">Done</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pop Dialog: API Key Configuration (Well structured, matching code pop up) */}
      <Dialog open={keyDrawerOpen} onOpenChange={setKeyDrawerOpen}>
        <DialogContent className="w-[92vw] max-w-md overflow-hidden border-border p-0 shadow-2xl sm:max-w-lg">
          <DialogHeader className="p-4 pb-3">
            <DialogTitle className="flex items-center gap-2 text-sm sm:text-base">
              <KeyRound className="size-4 text-primary" />
              <span>Connect API key</span>
            </DialogTitle>
            <DialogDescription>
              Use an existing key or create one for this session.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 p-4 pt-1">
            {apiKey ? (
              <div className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
                <span>Key connected for this session</span>
                <Button variant="outline" size="sm" onClick={handleClearKey}>
                  Disconnect
                </Button>
              </div>
            ) : null}

            {/* Quick 1-Click Key Generator */}
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3.5">
              <div className="flex items-center gap-2">
                <Sparkles className="size-3.5 text-primary" />
                <h4 className="text-xs font-semibold text-foreground">
                  Create a key
                </h4>
              </div>
              <p className="text-xs text-muted-foreground">
                Create a key and connect it to this browser session.
              </p>
              <Button
                size="sm"
                className="h-8 w-full cursor-pointer text-xs font-medium"
                onClick={handleCreatePlaygroundKey}
                disabled={isGeneratingKey}
              >
                <Sparkles className="mr-1.5 size-3.5" />
                {isGeneratingKey ? "Generating Key…" : "Generate & Connect Key"}
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Separator className="flex-1" />
              <span className="text-[10px] tracking-wider text-muted-foreground uppercase">
                Or paste key
              </span>
              <Separator className="flex-1" />
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="manual-key"
                className="text-xs font-medium text-foreground"
              >
                Existing API Key
              </Label>
              <Input
                id="manual-key"
                type="password"
                placeholder="sk-gw-api01-…"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                className="h-8 font-mono text-xs"
              />
              <Button
                variant="secondary"
                size="sm"
                className="h-8 w-full cursor-pointer text-xs"
                onClick={handleSaveManualKey}
                disabled={!keyInput.trim()}
              >
                Connect Entered Key
              </Button>
            </div>
          </div>

          <DialogFooter className="flex items-center justify-between border-t bg-muted/15 p-3 sm:justify-between">
            <span className="font-mono text-[11px] text-muted-foreground">
              Header: Authorization / x-api-key
            </span>
            <DialogClose asChild>
              <Button size="sm" variant="outline" className="h-8 text-xs">
                Close
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pop Dialog: Code Snippet Export (Well structured, no overflow, no overlap) */}
      <Dialog open={codeDrawerOpen} onOpenChange={setCodeDrawerOpen}>
        <DialogContent className="w-[92vw] max-w-2xl overflow-hidden border-border p-0 shadow-2xl sm:max-w-3xl">
          <DialogHeader className="p-4 pb-3">
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

          <div className="space-y-3 p-4 pt-0">
            {/* Toolbar: Language Tabs (Left) & Dedicated Copy Button (Right) */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5">
              <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setCodeLang("curl")}
                  className={cn(
                    "cursor-pointer rounded-md px-2.5 py-1 font-medium transition-colors",
                    codeLang === "curl"
                      ? "bg-background font-semibold text-foreground shadow-2xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  cURL
                </button>
                <button
                  type="button"
                  onClick={() => setCodeLang("python")}
                  className={cn(
                    "cursor-pointer rounded-md px-2.5 py-1 font-medium transition-colors",
                    codeLang === "python"
                      ? "bg-background font-semibold text-foreground shadow-2xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Python
                </button>
                <button
                  type="button"
                  onClick={() => setCodeLang("typescript")}
                  className={cn(
                    "cursor-pointer rounded-md px-2.5 py-1 font-medium transition-colors",
                    codeLang === "typescript"
                      ? "bg-background font-semibold text-foreground shadow-2xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  JavaScript
                </button>
              </div>

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
              <pre className="max-h-[380px] min-h-[160px] overflow-x-auto overflow-y-auto p-4 font-mono text-xs leading-relaxed whitespace-pre text-foreground select-all">
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
