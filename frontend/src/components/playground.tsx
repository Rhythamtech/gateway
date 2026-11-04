"use client"

import * as React from "react"
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Code,
  Copy,
  Cpu,
  KeyRound,
  Plus,
  RotateCcw,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Square,
  Terminal,
  User,
  X,
  Zap,
} from "lucide-react"
import { toast } from "sonner"

import {
  API_BASE_URL,
  createApiKey,
  getPlaygroundApiKey,
  listModelGroups,
  listProviderModels,
  listProviders,
  listV1Models,
  setPlaygroundApiKey,
  type CurrentUser,
} from "@/lib/auth"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "cn"

type PlaygroundProps = {
  user: CurrentUser
}

export type ChatMessage = {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: Date
  tokens?: number
  latencyMs?: number
  isStreaming?: boolean
  error?: boolean
}

type ModelChoice = {
  id: string
  label: string
  category: "model-group" | "provider-model" | "custom"
  detail?: string
  strategy?: string
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
  const [apiKey, setApiKey] = React.useState<string>(() => getPlaygroundApiKey() ?? "")
  const [keyInput, setKeyInput] = React.useState("")
  const [keyDrawerOpen, setKeyDrawerOpen] = React.useState(false)
  const [isGeneratingKey, setIsGeneratingKey] = React.useState(false)

  // Models state
  const [models, setModels] = React.useState<ModelChoice[]>([])
  const [selectedModel, setSelectedModel] = React.useState<string>("")
  const [customModel, setCustomModel] = React.useState<string>("")
  const [customModelInput, setCustomModelInput] = React.useState<string>("")
  const [isCustomMode, setIsCustomMode] = React.useState<boolean>(false)
  const [isLoadingModels, setIsLoadingModels] = React.useState(false)

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
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null)
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
  const [ttftMs, setTtftMs] = React.useState<number | null>(null)
  const [totalLatencyMs, setTotalLatencyMs] = React.useState<number | null>(null)
  const [tokensPerSec, setTokensPerSec] = React.useState<number | null>(null)
  const [usageStats, setUsageStats] = React.useState<{
    promptTokens: number
    completionTokens: number
    totalTokens: number
  } | null>(null)
  const [finishReason, setFinishReason] = React.useState<string | null>(null)

  // Code export & Inspector
  const [codeDrawerOpen, setCodeDrawerOpen] = React.useState(false)
  const [codeLang, setCodeLang] = React.useState<"curl" | "python" | "typescript">("curl")
  const [lastRawRequest, setLastRawRequest] = React.useState<string>("")
  const [lastRawResponse, setLastRawResponse] = React.useState<string>("")
  const [activeTab, setActiveTab] = React.useState<"chat" | "request" | "response">("chat")
  const [copiedCode, setCopiedCode] = React.useState(false)

  // Mobile parameters drawer toggle
  const [paramsDrawerOpen, setParamsDrawerOpen] = React.useState(false)

  // Load models on mount or when API key / role changes
  React.useEffect(() => {
    let cancelled = false
    setIsLoadingModels(true)

    async function fetchAvailableModels() {
      const choices: ModelChoice[] = []

      // 1. Superusers can test both Model Groups and Direct Provider models
      if (isSuperuser) {
        try {
          const groupList = await listModelGroups({ isEnabled: true, pageSize: 100 })
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
                detail: `${strategyLabel} · ${g.member_count} member(s)`,
              })
            }
          }
        } catch {
          // continue
        }

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

      // 2. Query /v1/models using API key (works for both user and superuser; only gateway models returned)
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
        if (choices.length > 0 && !selectedModel) {
          setSelectedModel(choices[0].id)
        }
        setIsLoadingModels(false)
      }
    }

    fetchAvailableModels()

    return () => {
      cancelled = true
    }
  }, [apiKey, isSuperuser])

  // Scroll conversation into view
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isGenerating])

  // 1-Click Key Generator
  async function handleCreatePlaygroundKey() {
    setIsGeneratingKey(true)
    try {
      const created = await createApiKey(`Playground Key (${new Date().toLocaleDateString()})`)
      setPlaygroundApiKey(created.api_key)
      setApiKey(created.api_key)
      setKeyDrawerOpen(false)
      toast.success("Playground API key connected!")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create API key.")
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
  const activeModelId = selectedModel === "__custom__" ? customModel.trim() : selectedModel
  const activeModelChoice = models.find((m) => m.id === activeModelId)

  // Filtered models for combobox popover
  const filteredModels = React.useMemo(() => {
    return models.filter((m) => {
      const matchesCategory = categoryFilter === "all" || m.category === categoryFilter
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
  async function handleSendMessage(promptText?: string) {
    const textToSend = promptText ?? inputPrompt
    if (!textToSend.trim() || isGenerating) return

    if (!apiKey) {
      setKeyDrawerOpen(true)
      toast.info("Connect an API key to test models.")
      return
    }

    if (!activeModelId) {
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
      content: "",
      timestamp: new Date(),
      isStreaming: stream,
    }

    const newMessages = [...messages, userMessage]
    setMessages([...newMessages, assistantPlaceholder])
    setInputPrompt("")
    setIsGenerating(true)
    setTtftMs(null)
    setTotalLatencyMs(null)
    setTokensPerSec(null)
    setUsageStats(null)
    setFinishReason(null)

    // Build chat payload
    const formattedMessages: { role: string; content: string }[] = []
    if (systemPrompt.trim()) {
      formattedMessages.push({ role: "system", content: systemPrompt.trim() })
    }
    for (const m of newMessages) {
      formattedMessages.push({ role: m.role, content: m.content })
    }

    const payload = {
      model: activeModelId,
      messages: formattedMessages,
      temperature,
      max_tokens: maxTokens,
      top_p: topP,
      stream,
    }

    const payloadJson = JSON.stringify(payload, null, 2)
    setLastRawRequest(payloadJson)
    setLastRawResponse("")

    const startTime = performance.now()
    let firstTokenTime: number | null = null
    let accumulatedContent = ""
    let tokenCount = 0

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

      if (!response.ok) {
        let errMessage = `Error ${response.status}: ${response.statusText}`
        try {
          const errData = await response.json()
          setLastRawResponse(JSON.stringify(errData, null, 2))
          if (errData?.error?.message) {
            errMessage = errData.error.message
          } else if (errData?.detail) {
            errMessage = typeof errData.detail === "string" ? errData.detail : JSON.stringify(errData.detail)
          }
        } catch {
          // ignore
        }

        if (response.status === 401) {
          errMessage = "Authentication failed: The API key is invalid or deactivated."
        } else if (response.status === 429) {
          errMessage = "Rate limit reached: The request exceeded the allowed rate."
        }

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: `⚠️ **Request Failed**\n\n${errMessage}`,
                  isStreaming: false,
                  error: true,
                }
              : msg
          )
        )
        setFinishReason("error")
        return
      }

      // Handle Streaming SSE
      if (stream && response.body) {
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        let rawLog = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          buffer += chunk
          rawLog += chunk

          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || trimmed.startsWith(":")) continue

            if (trimmed === "data: [DONE]") {
              setFinishReason((prev) => prev ?? "stop")
              continue
            }

            if (trimmed.startsWith("data: ")) {
              try {
                const data = JSON.parse(trimmed.slice(6))
                const delta = data.choices?.[0]?.delta?.content
                if (delta) {
                  if (firstTokenTime === null) {
                    firstTokenTime = performance.now()
                    setTtftMs(Math.round(firstTokenTime - startTime))
                  }
                  accumulatedContent += delta
                  tokenCount += 1

                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId
                        ? { ...msg, content: accumulatedContent, isStreaming: true }
                        : msg
                    )
                  )
                }

                if (data.choices?.[0]?.finish_reason) {
                  setFinishReason(data.choices[0].finish_reason)
                }
                if (data.usage) {
                  setUsageStats({
                    promptTokens: data.usage.prompt_tokens ?? 0,
                    completionTokens: data.usage.completion_tokens ?? 0,
                    totalTokens: data.usage.total_tokens ?? 0,
                  })
                }
              } catch {
                // partial JSON chunk
              }
            }
          }
        }

        setLastRawResponse(rawLog)
        const totalDuration = Math.round(performance.now() - startTime)
        setTotalLatencyMs(totalDuration)

        if (tokenCount > 0 && totalDuration > 0) {
          const tps = Math.round((tokenCount / (totalDuration / 1000)) * 10) / 10
          setTokensPerSec(tps)
        }

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: accumulatedContent || "(No response content returned)",
                  isStreaming: false,
                  latencyMs: totalDuration,
                  tokens: tokenCount,
                }
              : msg
          )
        )
      } else {
        // Non-streaming JSON response
        const data = await response.json()
        setLastRawResponse(JSON.stringify(data, null, 2))
        const totalDuration = Math.round(performance.now() - startTime)
        setTotalLatencyMs(totalDuration)

        const content = data.choices?.[0]?.message?.content ?? ""
        const reason = data.choices?.[0]?.finish_reason ?? "stop"
        setFinishReason(reason)

        if (data.usage) {
          setUsageStats({
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens ?? 0,
          })
          if (data.usage.completion_tokens && totalDuration > 0) {
            setTokensPerSec(
              Math.round((data.usage.completion_tokens / (totalDuration / 1000)) * 10) / 10
            )
          }
        }

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: content || "(Empty response)",
                  isStreaming: false,
                  latencyMs: totalDuration,
                  tokens: data.usage?.completion_tokens,
                }
              : msg
          )
        )
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setFinishReason("cancelled")
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: accumulatedContent + "\n\n*(Generation stopped by user)*",
                  isStreaming: false,
                }
              : msg
          )
        )
      } else {
        const errorMsg = err instanceof Error ? err.message : "Network error."
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: `⚠️ **Request Error**: ${errorMsg}`,
                  isStreaming: false,
                  error: true,
                }
              : msg
          )
        )
      }
    } finally {
      setIsGenerating(false)
      abortControllerRef.current = null
    }
  }

  function handleStopGeneration() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }

  function handleClearChat() {
    handleStopGeneration()
    setMessages([])
    setTtftMs(null)
    setTotalLatencyMs(null)
    setTokensPerSec(null)
    setUsageStats(null)
    setFinishReason(null)
    setLastRawRequest("")
    setLastRawResponse("")
    toast.info("Conversation cleared.")
  }

  function handleCopyContent(text: string) {
    navigator.clipboard.writeText(text)
    toast.success("Copied to clipboard.")
  }

  // Dynamic code snippets
  function getCodeSnippet(): string {
    const formattedMessages: { role: string; content: string }[] = []
    if (systemPrompt.trim()) {
      formattedMessages.push({ role: "system", content: systemPrompt.trim() })
    }
    for (const m of messages) {
      formattedMessages.push({ role: m.role, content: m.content })
    }
    if (formattedMessages.length === 0) {
      formattedMessages.push({ role: "user", content: "Hello!" })
    }

    const payload = {
      model: activeModelId || "your-model-id",
      messages: formattedMessages,
      temperature,
      max_tokens: maxTokens,
      top_p: topP,
      stream,
    }

    const keyPlaceholder = apiKey || "YOUR_API_KEY"

    if (codeLang === "curl") {
      return `curl -X POST "${API_BASE_URL}/v1/chat/completions" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${keyPlaceholder}" \\
  -d '${JSON.stringify(payload, null, 2)}'`
    }

    if (codeLang === "python") {
      return `from openai import OpenAI

client = OpenAI(
    base_url="${API_BASE_URL}/v1",
    api_key="${keyPlaceholder}",
)

response = client.chat.completions.create(
    model="${activeModelId || "your-model-id"}",
    messages=${JSON.stringify(formattedMessages, null, 4)},
    temperature=${temperature},
    max_tokens=${maxTokens},
    top_p=${topP},
    stream=${stream ? "True" : "False"},
)

${
  stream
    ? `for chunk in response:
    content = chunk.choices[0].delta.content or ""
    print(content, end="", flush=True)`
    : `print(response.choices[0].message.content)`
}`
    }

    return `// JavaScript / TypeScript
const response = await fetch("${API_BASE_URL}/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer ${keyPlaceholder}",
  },
  body: JSON.stringify(${JSON.stringify(payload, null, 2)}),
});

${
  stream
    ? `const reader = response.body.getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log(decoder.decode(value));
}`
    : `const data = await response.json();
console.log(data.choices[0].message.content);`
}`
  }

  // Parameters Sidebar Content (Shared between desktop and mobile drawer)
  const ParametersSidebar = (
    <div className="flex flex-col gap-4">
      {/* Parameter Controls Card */}
      <div className="rounded-xl border bg-card text-card-foreground shadow-2xs overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3 bg-muted/10">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">Parameters</span>
          </div>
          <span className="text-[10px] text-muted-foreground">Sampling</span>
        </div>
        <div className="space-y-4 p-4 text-xs">
          {/* Temperature */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="param-temp" className="text-xs font-medium text-foreground cursor-pointer">
                Temperature
              </Label>
              <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
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
              <Label htmlFor="param-max-tokens" className="text-xs font-medium text-foreground cursor-pointer">
                Max Output Tokens
              </Label>
              <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
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
            <div className="flex justify-between text-[10px] text-muted-foreground/70 font-mono">
              <span>256</span>
              <span>2,048</span>
              <span>4,096</span>
              <span>8,192</span>
            </div>
          </div>

          {/* Top P */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="param-top-p" className="text-xs font-medium text-foreground cursor-pointer">
                Top P (Nucleus)
              </Label>
              <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
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
              <Label htmlFor="param-stream" className="text-xs font-medium text-foreground cursor-pointer">
                Stream Output
              </Label>
              <p className="text-[10px] text-muted-foreground">Server-Sent Events (SSE) chunks</p>
            </div>
            <Checkbox
              id="param-stream"
              checked={stream}
              onCheckedChange={(checked) => setStream(Boolean(checked))}
            />
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex flex-1 flex-col gap-3 px-4 lg:px-6">
      {/* Sleek Integrated Toolbar (No clunky outer card wrapper) */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b pb-3">
        {/* Left: Clean Model Selector & System Instructions Toggle */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Model Combobox Popover */}
          <Popover open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={modelPickerOpen}
                className="h-9 gap-2 border-border/70 bg-background/80 px-3 font-normal shadow-2xs hover:bg-accent/50 hover:border-border transition-colors"
              >
                <Cpu className="size-4 text-primary shrink-0" />
                <span className="font-medium text-xs sm:text-sm text-foreground truncate max-w-[150px] sm:max-w-[240px]">
                  {activeModelChoice ? activeModelChoice.label : activeModelId || "Select a model"}
                </span>

                {isSuperuser ? (
                  activeModelChoice?.category === "model-group" ? (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal text-muted-foreground">
                      {activeModelChoice.strategy === "priority"
                        ? "Priority"
                        : activeModelChoice.strategy === "weighted_round_robin"
                        ? "WRR"
                        : "Group"}
                    </Badge>
                  ) : activeModelChoice?.category === "provider-model" ? (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal text-muted-foreground">
                      Direct
                    </Badge>
                  ) : selectedModel === "__custom__" ? (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 font-normal text-primary">
                      Custom
                    </Badge>
                  ) : null
                ) : null}

                <ChevronsUpDown className="size-3.5 text-muted-foreground shrink-0 ml-0.5 opacity-60" />
              </Button>
            </PopoverTrigger>

            <PopoverContent align="start" className="w-[320px] sm:w-[380px] p-0 shadow-xl border-border">
              {/* Search Bar */}
              <div className="flex items-center border-b px-3 py-2">
                <Search className="mr-2 size-3.5 shrink-0 text-muted-foreground" />
                <input
                  placeholder={isSuperuser ? "Search models or providers…" : "Search models…"}
                  value={modelSearchQuery}
                  onChange={(e) => setModelSearchQuery(e.target.value)}
                  className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
                  autoFocus
                />
                {modelSearchQuery ? (
                  <button
                    type="button"
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
              <div className="max-h-72 overflow-y-auto p-1.5 space-y-0.5">
                {isLoadingModels ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">
                    Discovering models…
                  </div>
                ) : filteredModels.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted-foreground">
                    {!apiKey && !isSuperuser
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
                            ? "bg-primary/10 text-primary font-medium"
                            : "hover:bg-muted text-foreground"
                        )}
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          <Check
                            className={cn(
                              "size-3.5 shrink-0",
                              isSelected ? "opacity-100 text-primary" : "opacity-0"
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
                            variant={m.category === "model-group" ? "secondary" : "outline"}
                            className="shrink-0 text-[10px] px-1.5 py-0 font-normal text-muted-foreground"
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
                        placeholder="e.g. openai/gpt-4o"
                        className="h-7 text-xs font-mono"
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

          {/* System Instructions Toggle Pill */}
          <Button
            variant={showSystemPrompt ? "secondary" : "ghost"}
            size="sm"
            className="h-9 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowSystemPrompt(!showSystemPrompt)}
          >
            <Terminal className="size-3.5" />
            <span>System Prompt</span>
            {systemPrompt.trim() ? (
              <span className="size-1.5 rounded-full bg-primary" />
            ) : null}
          </Button>
        </div>

        {/* Right: Key Badge, Code, Clear, Mobile Params */}
        <div className="flex items-center gap-1.5">
          {/* API Key Status Pill */}
          {apiKey ? (
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 border-emerald-500/30 bg-emerald-500/10 px-2.5 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
              onClick={() => setKeyDrawerOpen(true)}
            >
              <span className="size-1.5 rounded-full bg-emerald-500" />
              <span className="font-mono text-xs">
                {apiKey.startsWith("sk-") ? `${apiKey.slice(0, 10)}…` : "API Key"}
              </span>
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 border-amber-500/40 px-2.5 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
              onClick={() => setKeyDrawerOpen(true)}
            >
              <KeyRound className="size-3.5" />
              <span className="text-xs">Connect Key</span>
            </Button>
          )}

          {/* View Code */}
          <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setCodeDrawerOpen(true)}
          >
            <Code className="size-3.5" />
            <span className="hidden sm:inline">View Code</span>
          </Button>

          {/* Clear Chat */}
          <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-destructive"
            onClick={handleClearChat}
            disabled={messages.length === 0 && !isGenerating}
          >
            <RotateCcw className="size-3.5" />
            <span className="hidden sm:inline">Clear</span>
          </Button>

          {/* Mobile Parameters Sheet Trigger */}
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-2 text-xs lg:hidden"
            onClick={() => setParamsDrawerOpen(true)}
          >
            <SlidersHorizontal className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Main Split Grid: Unified Chat Workspace (Left) & Parameters (Right) */}
      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left Area (8 cols on desktop, 9 on xl): Unified Chat Workspace Card */}
        <div className="flex flex-col lg:col-span-8 xl:col-span-9">
          <Card className="flex flex-1 flex-col overflow-hidden rounded-xl border shadow-2xs min-h-[580px]">
            {/* Header: Conversation / Request / Response Tabs & Live Status */}
            <CardHeader className="flex flex-row items-center justify-between border-b px-4 py-2 bg-muted/10">
              <Tabs
                value={activeTab}
                onValueChange={(val) => setActiveTab(val as "chat" | "request" | "response")}
                className="w-auto"
              >
                <TabsList className="h-8">
                  <TabsTrigger value="chat" className="text-xs px-3">
                    Conversation
                  </TabsTrigger>
                  <TabsTrigger value="request" className="text-xs px-3">
                    Request JSON
                  </TabsTrigger>
                  <TabsTrigger value="response" className="text-xs px-3">
                    Response Trace
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="flex items-center gap-2">
                {isGenerating ? (
                  <Badge variant="outline" className="animate-pulse border-primary/50 text-[11px] py-0.5 px-2.5">
                    <Sparkles className="mr-1 size-3 text-primary" />
                    Generating…
                  </Badge>
                ) : finishReason ? (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[11px] py-0.5 px-2",
                      finishReason === "error"
                        ? "border-destructive text-destructive"
                        : "text-muted-foreground"
                    )}
                  >
                    Finish: {finishReason}
                  </Badge>
                ) : null}
              </div>
            </CardHeader>

            {/* Seamless System Prompt Drawer (Opens inline inside the canvas, zero wasted height when closed) */}
            {showSystemPrompt ? (
              <div className="border-b bg-muted/20 px-4 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <Terminal className="size-3.5 text-primary" />
                    <span>System Instructions</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px] text-muted-foreground"
                    onClick={() => setShowSystemPrompt(false)}
                  >
                    Hide
                  </Button>
                </div>
                <Textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Set role instructions, persona, or output format guidelines for the model…"
                  className="min-h-[64px] resize-y text-xs bg-background"
                />
              </div>
            ) : null}

            {/* Main Chat Feed */}
            <CardContent className="flex flex-1 flex-col overflow-y-auto p-4">
              {activeTab === "chat" ? (
                <div className="flex flex-1 flex-col justify-between space-y-4">
                  {/* Empty state with starter prompts */}
                  {messages.length === 0 ? (
                    <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
                      <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-2xs">
                        <Sparkles className="size-5" />
                      </div>
                      <h3 className="mt-3 text-sm font-semibold text-foreground">Model Playground</h3>
                      <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                        {isSuperuser
                          ? "Test model groups and direct provider endpoints with real-time SSE streaming and token telemetry."
                          : "Test gateway models with real-time SSE streaming and token telemetry."}
                      </p>

                      <div className="mt-6 grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
                        {STARTER_PROMPTS.map((prompt, i) => (
                          <button
                            key={i}
                            type="button"
                            className="rounded-lg border bg-muted/20 p-2.5 text-left text-xs transition-colors hover:border-primary/50 hover:bg-muted/50"
                            onClick={() => handleSendMessage(prompt)}
                          >
                            <p className="line-clamp-2 text-foreground">{prompt}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    /* Messages list */
                    <div className="space-y-4">
                      {messages.map((message) => {
                        const isUser = message.role === "user"
                        return (
                          <div
                            key={message.id}
                            className={`flex gap-2.5 ${isUser ? "justify-end" : "justify-start"}`}
                          >
                            {!isUser ? (
                              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-2xs">
                                <Bot className="size-3.5" />
                              </div>
                            ) : null}

                            <div
                              className={`group relative max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm shadow-2xs ${
                                isUser
                                  ? "bg-primary text-primary-foreground rounded-tr-xs"
                                  : message.error
                                    ? "border border-destructive/40 bg-destructive/10 text-foreground rounded-tl-xs"
                                    : "border bg-muted/30 text-foreground rounded-tl-xs"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-4 pb-1">
                                <span
                                  className={`text-[10px] font-semibold tracking-wider uppercase ${
                                    isUser ? "text-primary-foreground/75" : "text-muted-foreground"
                                  }`}
                                >
                                  {isUser ? "You" : activeModelId || "Assistant"}
                                </span>
                                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                  <button
                                    type="button"
                                    className={`rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10 ${
                                      isUser ? "text-primary-foreground" : "text-muted-foreground"
                                    }`}
                                    onClick={() => handleCopyContent(message.content)}
                                    title="Copy content"
                                  >
                                    <Copy className="size-3" />
                                  </button>
                                </div>
                              </div>

                              <div className="whitespace-pre-wrap leading-relaxed text-xs sm:text-sm">
                                {message.content}
                                {message.isStreaming && !message.content ? (
                                  <span className="inline-block animate-pulse text-muted-foreground text-xs">
                                    Waiting for first token…
                                  </span>
                                ) : null}
                                {message.isStreaming && message.content ? (
                                  <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary ml-1" />
                                ) : null}
                              </div>

                              {message.latencyMs || message.tokens ? (
                                <div className="mt-2 flex items-center gap-2 border-t border-border/30 pt-1 text-[10px] text-muted-foreground">
                                  {message.latencyMs ? <span>{message.latencyMs} ms</span> : null}
                                  {message.tokens ? <span>· {message.tokens} tokens</span> : null}
                                </div>
                              ) : null}
                            </div>

                            {isUser ? (
                              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                <User className="size-3.5" />
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </div>
              ) : activeTab === "request" ? (
                <div className="h-full">
                  <pre className="h-96 overflow-auto rounded-lg bg-muted/40 p-3 font-mono text-xs text-foreground">
                    {lastRawRequest || "// No request dispatched yet."}
                  </pre>
                </div>
              ) : (
                <div className="h-full">
                  <pre className="h-96 overflow-auto rounded-lg bg-muted/40 p-3 font-mono text-xs text-foreground">
                    {lastRawResponse || "// No response trace received yet."}
                  </pre>
                </div>
              )}
            </CardContent>

            {/* Linear-Style Modern Combined Composer & Live Telemetry Statusline */}
            <div className="border-t border-border/60 bg-muted/5 p-3 sm:p-4 space-y-2.5">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  handleSendMessage()
                }}
                className={cn(
                  "relative flex flex-col rounded-xl border border-input/80 bg-background shadow-2xs transition-all duration-200",
                  "focus-within:border-ring/80 focus-within:ring-2 focus-within:ring-ring/20 dark:bg-muted/15 dark:border-border/60"
                )}
              >
                {/* Borderless Expanding Textarea */}
                <textarea
                  ref={textareaRef}
                  value={inputPrompt}
                  onChange={(e) => setInputPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      handleSendMessage()
                    }
                  }}
                  rows={1}
                  placeholder={
                    apiKey
                      ? "Ask anything, test prompts, or enter instructions…"
                      : "Connect API key to begin testing models…"
                  }
                  className="w-full resize-none border-0 bg-transparent px-3.5 pt-3 pb-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/60 outline-none focus:outline-none focus:ring-0 min-h-[50px] max-h-44"
                  disabled={isGenerating}
                />

                {/* Bottom Combined Tray */}
                <div className="flex items-center justify-between px-3 pb-2 pt-1 border-t border-transparent">
                  {/* Left: Active Model Pill & Keyboard Shortcut Hints */}
                  <div className="flex items-center gap-2 overflow-hidden text-xs text-muted-foreground">
                    {activeModelId ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground/90">
                        <span className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
                        <span className="truncate max-w-[130px] sm:max-w-[220px]">{activeModelId}</span>
                      </span>
                    ) : null}
                    <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-muted-foreground/50 select-none">
                      <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[9px] text-muted-foreground/70">↵</kbd>
                      <span>send</span>
                      <span className="opacity-40">·</span>
                      <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[9px] text-muted-foreground/70">⇧↵</kbd>
                      <span>new line</span>
                    </span>
                  </div>

                  {/* Right: Modern Integrated Action Button */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isGenerating ? (
                      <button
                        type="button"
                        onClick={handleStopGeneration}
                        title="Stop generation"
                        className="flex size-7 items-center justify-center rounded-lg bg-foreground text-background shadow-2xs hover:bg-destructive hover:text-destructive-foreground active:scale-95 transition-all cursor-pointer"
                      >
                        <Square className="size-3 fill-current" />
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={!inputPrompt.trim() || isGenerating}
                        title="Send message (Enter)"
                        className={cn(
                          "flex size-7 items-center justify-center rounded-lg transition-all",
                          inputPrompt.trim()
                            ? "bg-primary text-primary-foreground shadow-2xs hover:opacity-90 active:scale-95 cursor-pointer"
                            : "bg-muted text-muted-foreground/35 cursor-not-allowed"
                        )}
                      >
                        <ArrowUp className="size-3.5" strokeWidth={2.5} />
                      </button>
                    )}
                  </div>
                </div>
              </form>

              {/* Statusline: Live Telemetry below chat input */}
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 text-[11px] font-mono text-muted-foreground select-none">
                <div className="flex items-center gap-2 overflow-hidden">
                  {/* Status Indicator */}
                  <div className="flex items-center gap-1.5 font-sans">
                    {isGenerating ? (
                      <span className="inline-flex items-center gap-1.5 font-medium text-primary">
                        <span className="size-2 rounded-full bg-primary animate-pulse" />
                        <span>Streaming…</span>
                      </span>
                    ) : finishReason ? (
                      <span className="inline-flex items-center gap-1.5 text-foreground/80">
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            finishReason === "error" ? "bg-destructive" : "bg-emerald-500"
                          )}
                        />
                        <span className="capitalize">{finishReason}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground/60">
                        <span className="size-1.5 rounded-full bg-muted-foreground/30" />
                        <span>Ready</span>
                      </span>
                    )}
                  </div>

                  <span className="text-border/80">|</span>

                  {/* TTFT */}
                  <span className="inline-flex items-center gap-1">
                    <span className="text-muted-foreground/70">TTFT:</span>
                    <span
                      className={cn(
                        "tabular-nums",
                        ttftMs !== null ? "text-foreground font-medium" : "text-muted-foreground/50"
                      )}
                    >
                      {ttftMs !== null ? `${ttftMs}ms` : "—"}
                    </span>
                  </span>

                  <span className="text-muted-foreground/30">·</span>

                  {/* Latency */}
                  <span className="inline-flex items-center gap-1">
                    <span className="text-muted-foreground/70">Latency:</span>
                    <span
                      className={cn(
                        "tabular-nums",
                        totalLatencyMs !== null ? "text-foreground font-medium" : "text-muted-foreground/50"
                      )}
                    >
                      {totalLatencyMs !== null ? `${totalLatencyMs}ms` : "—"}
                    </span>
                  </span>

                  <span className="text-muted-foreground/30">·</span>

                  {/* Speed */}
                  <span className="inline-flex items-center gap-1">
                    <span className="text-muted-foreground/70">Speed:</span>
                    <span
                      className={cn(
                        "tabular-nums",
                        tokensPerSec !== null ? "text-foreground font-medium" : "text-muted-foreground/50"
                      )}
                    >
                      {tokensPerSec !== null ? `${tokensPerSec} tps` : "—"}
                    </span>
                  </span>
                </div>

                {/* Right side: Token counts */}
                <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px]">
                  <Zap className="size-3 text-amber-500/80 shrink-0" />
                  {usageStats ? (
                    <span>
                      <span className="text-foreground font-semibold tabular-nums">{usageStats.completionTokens}</span>
                      <span className="text-muted-foreground/70"> out</span>
                      <span className="text-muted-foreground/40 mx-1">·</span>
                      <span className="text-foreground font-semibold tabular-nums">{usageStats.promptTokens}</span>
                      <span className="text-muted-foreground/70"> in</span>
                      <span className="text-muted-foreground/40 mx-1">·</span>
                      <span className="text-foreground font-semibold tabular-nums">{usageStats.totalTokens}</span>
                      <span className="text-muted-foreground/70"> tok</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">0 tokens</span>
                  )}
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Right Area (4 cols desktop, 3 on xl): Parameters Sidebar */}
        <div className="hidden lg:flex lg:col-span-4 xl:col-span-3 flex-col gap-4">
          {ParametersSidebar}
        </div>
      </div>

      {/* Drawer: Mobile Parameters */}
      <Drawer open={paramsDrawerOpen} onOpenChange={setParamsDrawerOpen}>
        <DrawerContent className="mx-auto max-w-lg p-4 max-h-[85vh] overflow-y-auto">
          <DrawerHeader className="px-0">
            <DrawerTitle>Model Parameters</DrawerTitle>
            <DrawerDescription>Configure sampling hyperparameters.</DrawerDescription>
          </DrawerHeader>
          <div className="py-2">{ParametersSidebar}</div>
          <DrawerFooter className="px-0 pt-2">
            <DrawerClose asChild>
              <Button variant="outline">Done</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Pop Dialog: API Key Configuration (Well structured, matching code pop up) */}
      <Dialog open={keyDrawerOpen} onOpenChange={setKeyDrawerOpen}>
        <DialogContent className="max-w-md sm:max-w-lg w-[92vw] p-0 overflow-hidden shadow-2xl border-border">
          <DialogHeader className="p-4 pb-3">
            <DialogTitle className="flex items-center gap-2 text-sm sm:text-base">
              <KeyRound className="size-4 text-primary" />
              <span>Connect Playground API Key</span>
            </DialogTitle>
            <DialogDescription>
              The gateway requires an API key to authenticate model requests, record traces, and meter token usage.
            </DialogDescription>
          </DialogHeader>

          <div className="p-4 pt-1 space-y-4">
            {apiKey ? (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-emerald-800 dark:text-emerald-200">
                    Currently Connected
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[11px] border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300 cursor-pointer"
                    onClick={handleClearKey}
                  >
                    Disconnect
                  </Button>
                </div>
                <p className="mt-1.5 font-mono text-[11px] break-all text-emerald-700 dark:text-emerald-300 bg-background/60 rounded p-2 border border-emerald-500/20">
                  {apiKey}
                </p>
              </div>
            ) : null}

            {/* Quick 1-Click Key Generator */}
            <div className="rounded-lg border bg-muted/30 p-3.5 space-y-2">
              <div className="flex items-center gap-2">
                <Sparkles className="size-3.5 text-primary" />
                <h4 className="text-xs font-semibold text-foreground">1-Click Playground Key</h4>
              </div>
              <p className="text-xs text-muted-foreground">
                Generate an instant temporary API key saved to this browser session for immediate testing.
              </p>
              <Button
                size="sm"
                className="w-full h-8 text-xs font-medium cursor-pointer"
                onClick={handleCreatePlaygroundKey}
                disabled={isGeneratingKey}
              >
                <Sparkles className="mr-1.5 size-3.5" />
                {isGeneratingKey ? "Generating Key…" : "Generate & Connect Key"}
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Separator className="flex-1" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Or paste key</span>
              <Separator className="flex-1" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="manual-key" className="text-xs font-medium text-foreground">
                Existing API Key
              </Label>
              <Input
                id="manual-key"
                type="password"
                placeholder="sk-gw-api01-…"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                className="font-mono text-xs h-8"
              />
              <Button
                variant="secondary"
                size="sm"
                className="w-full h-8 text-xs cursor-pointer"
                onClick={handleSaveManualKey}
                disabled={!keyInput.trim()}
              >
                Connect Entered Key
              </Button>
            </div>
          </div>

          <DialogFooter className="p-3 bg-muted/15 border-t flex items-center justify-between sm:justify-between">
            <span className="text-[11px] text-muted-foreground font-mono">
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
        <DialogContent className="max-w-2xl sm:max-w-3xl w-[92vw] p-0 overflow-hidden shadow-2xl border-border">
          <DialogHeader className="p-4 pb-3">
            <DialogTitle className="flex items-center gap-2 text-sm sm:text-base">
              <Code className="size-4 text-primary" />
              <span>Integration Code</span>
            </DialogTitle>
            <DialogDescription>
              Ready-to-use client snippets matching your selected model, parameters, and conversation history.
            </DialogDescription>
          </DialogHeader>

          <div className="p-4 pt-0 space-y-3">
            {/* Toolbar: Language Tabs (Left) & Dedicated Copy Button (Right) */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5">
              <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setCodeLang("curl")}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-medium transition-colors cursor-pointer",
                    codeLang === "curl"
                      ? "bg-background text-foreground shadow-2xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  cURL
                </button>
                <button
                  type="button"
                  onClick={() => setCodeLang("python")}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-medium transition-colors cursor-pointer",
                    codeLang === "python"
                      ? "bg-background text-foreground shadow-2xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Python
                </button>
                <button
                  type="button"
                  onClick={() => setCodeLang("typescript")}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-medium transition-colors cursor-pointer",
                    codeLang === "typescript"
                      ? "bg-background text-foreground shadow-2xs font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  TypeScript / Node
                </button>
              </div>

              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 px-3 text-xs"
                onClick={() => {
                  navigator.clipboard.writeText(getCodeSnippet())
                  setCopiedCode(true)
                  setTimeout(() => setCopiedCode(false), 2000)
                  toast.success("Snippet copied to clipboard.")
                }}
              >
                {copiedCode ? (
                  <Check className="size-3.5 text-emerald-500" />
                ) : (
                  <Copy className="size-3.5 text-muted-foreground" />
                )}
                <span>{copiedCode ? "Copied" : "Copy Code"}</span>
              </Button>
            </div>

            {/* Well-Structured Code Container (Controlled overflow, no overlapping) */}
            <div className="relative rounded-lg border border-border/80 bg-muted/40 overflow-hidden">
              <pre className="max-h-[380px] min-h-[160px] overflow-x-auto overflow-y-auto p-4 font-mono text-xs leading-relaxed text-foreground whitespace-pre select-all">
                <code>{getCodeSnippet()}</code>
              </pre>
            </div>
          </div>

          <DialogFooter className="p-3 bg-muted/15 border-t flex items-center justify-between sm:justify-between">
            <span className="text-[11px] text-muted-foreground font-mono">
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
