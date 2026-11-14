import { Bot, Code, Sliders, User, Wrench } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
} from "@/components/ui/message"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { PlaygroundMarkdown } from "@/components/playground-markdown"
import { CopyButton } from "./shared"

export function RequestBlock({
  request,
}: {
  request: Record<string, unknown> | null
}) {
  const payload =
    request && Object.keys(request).length
      ? JSON.stringify(request, null, 2)
      : null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Code className="size-4 text-muted-foreground" />
          <h3 className="text-base font-semibold text-foreground">
            Raw Request Payload
          </h3>
        </div>
        {payload ? <CopyButton value={payload} label="Copy JSON" /> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Raw JSON payload sent with the inbound request.
      </p>
      {payload ? (
        <pre
          tabIndex={0}
          className="max-h-[500px] overflow-auto rounded-lg bg-muted/40 p-4 font-mono text-xs leading-5 break-all whitespace-pre-wrap select-text focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          {payload}
        </pre>
      ) : (
        <p className="py-2 text-sm text-muted-foreground">
          No request payload was stored for this record.
        </p>
      )}
    </div>
  )
}

export function RequestParametersView({
  request,
}: {
  request: Record<string, unknown> | null
}) {
  if (!request) return null

  const paramKeys = [
    "temperature",
    "max_tokens",
    "top_p",
    "top_k",
    "stream",
    "frequency_penalty",
    "presence_penalty",
    "seed",
    "stop",
    "response_format",
  ]

  const activeParams = paramKeys
    .filter((k) => request[k] !== undefined && request[k] !== null)
    .map((k) => ({
      key: k,
      value:
        typeof request[k] === "object"
          ? JSON.stringify(request[k])
          : String(request[k]),
    }))

  if (!activeParams.length) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="mr-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Sliders className="size-3.5" />
        <span>Parameters:</span>
      </div>
      {activeParams.map((param) => (
        <Badge
          key={param.key}
          variant="secondary"
          className="gap-1.5 font-normal"
        >
          <span className="text-muted-foreground">{param.key}:</span>
          <span className="font-semibold text-foreground">{param.value}</span>
        </Badge>
      ))}
    </div>
  )
}

export function RequestMessagesView({
  request,
  modelName,
}: {
  request: Record<string, unknown> | null
  modelName?: string
}) {
  const messages = Array.isArray(request?.messages) ? request.messages : null
  const rawPrompt = typeof request?.prompt === "string" ? request.prompt : null

  if (rawPrompt && !messages?.length) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline">Prompt</Badge>
            <h4 className="text-sm font-medium text-foreground">
              Inbound Completion Prompt
            </h4>
          </div>
          <CopyButton value={rawPrompt} label="Copy prompt" />
        </div>
        <pre className="max-h-96 overflow-auto rounded-lg bg-muted/30 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap select-text">
          {rawPrompt}
        </pre>
      </div>
    )
  }

  if (!messages || !messages.length) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        No conversation messages recorded in this request.
      </p>
    )
  }

  return (
    <MessageGroup className="flex flex-col gap-6">
      {messages.map((rawMsg: unknown, idx: number) => {
        const msg = rawMsg as {
          role?: string
          content?: unknown
          tool_calls?: unknown[]
        }
        const role = typeof msg?.role === "string" ? msg.role : "unknown"
        const content =
          typeof msg?.content === "string"
            ? msg.content
            : msg?.content != null
              ? JSON.stringify(msg.content, null, 2)
              : ""

        // System Message: clean distinct block
        if (role === "system") {
          return (
            <div
              key={idx}
              className="flex flex-col gap-2 rounded-lg bg-muted/30 p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    System
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    #{idx + 1}
                  </span>
                </div>
                {content ? (
                  <CopyButton
                    value={content}
                    label="Copy system prompt"
                    iconOnly
                  />
                ) : null}
              </div>
              <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap select-text">
                {content || (
                  <span className="text-muted-foreground italic">
                    (empty content)
                  </span>
                )}
              </pre>
            </div>
          )
        }

        // User Message: aligned right, bubble variant="default"
        if (role === "user") {
          return (
            <Message key={idx} align="end">
              <MessageContent>
                <MessageHeader className="justify-end gap-2 text-xs text-muted-foreground">
                  <span>User</span>
                  <span>#{idx + 1}</span>
                </MessageHeader>
                <Bubble variant="default" align="end">
                  <BubbleContent className="whitespace-pre-wrap select-text">
                    {content || <span className="italic">(empty content)</span>}
                  </BubbleContent>
                </Bubble>
                {content ? (
                  <MessageFooter className="justify-end">
                    <CopyButton
                      value={content}
                      label="Copy user message"
                      iconOnly
                    />
                  </MessageFooter>
                ) : null}
              </MessageContent>
              <MessageAvatar>
                <Avatar className="size-8">
                  <AvatarFallback className="text-xs">
                    <User className="size-4" />
                  </AvatarFallback>
                </Avatar>
              </MessageAvatar>
            </Message>
          )
        }

        // Assistant Message: aligned left, bubble variant="outline" with markdown
        return (
          <div key={idx} className="flex flex-col gap-3">
            <Message align="start">
              <MessageAvatar>
                <Avatar className="size-8">
                  <AvatarFallback className="text-xs">
                    <Bot className="size-4" />
                  </AvatarFallback>
                </Avatar>
              </MessageAvatar>
              <MessageContent>
                <MessageHeader className="gap-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    Assistant
                  </span>
                  {modelName ? (
                    <Badge
                      variant="secondary"
                      className="px-1.5 py-0 text-[10px] font-normal"
                    >
                      {modelName}
                    </Badge>
                  ) : null}
                  <span>#{idx + 1}</span>
                </MessageHeader>
                <Bubble
                  variant="outline"
                  align="start"
                  className="w-full max-w-full"
                >
                  <BubbleContent className="w-full max-w-full text-foreground select-text">
                    {content ? (
                      <PlaygroundMarkdown content={content} />
                    ) : (
                      <span className="text-muted-foreground italic">
                        (empty content)
                      </span>
                    )}
                  </BubbleContent>
                </Bubble>
                {content ? (
                  <MessageFooter>
                    <CopyButton
                      value={content}
                      label="Copy assistant response"
                      iconOnly
                    />
                  </MessageFooter>
                ) : null}
              </MessageContent>
            </Message>

            {/* Tool Calls if present */}
            {Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0 ? (
              <div className="ml-10 flex flex-col gap-2 rounded-lg bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <Wrench className="size-3.5" />
                    <span>Tool Calls ({msg.tool_calls.length})</span>
                  </div>
                  <CopyButton
                    value={JSON.stringify(msg.tool_calls, null, 2)}
                    label="Copy tool calls"
                    iconOnly
                  />
                </div>
                <pre className="max-h-48 overflow-x-auto font-mono text-[11px] leading-5 select-text">
                  {JSON.stringify(msg.tool_calls, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        )
      })}
    </MessageGroup>
  )
}
