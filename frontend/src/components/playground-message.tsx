import * as React from "react"
import { ArrowRight, ChevronRight, Copy, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Message,
  MessageContent,
  MessageHeader,
  MessageFooter,
} from "@/components/ui/message"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { PlaygroundMarkdown } from "@/components/playground-markdown"
import { cn } from "cn"

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

async function copyMessageContent(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success("Copied to clipboard.")
  } catch {
    toast.error("Unable to copy. Select the message text and copy it manually.")
  }
}

export const PlaygroundMessage = React.memo(function PlaygroundMessage({
  message,
  modelId,
  onRetry,
  defaultFormat = "md",
}: {
  message: ChatMessage
  modelId: string
  onRetry?: () => void
  defaultFormat?: "md" | "text"
}) {
  const isUser = message.role === "user"
  const [format, setFormat] = React.useState<"md" | "text">(defaultFormat)

  React.useEffect(() => {
    setFormat(defaultFormat)
  }, [defaultFormat])

  return (
    <Message
      align={isUser ? "end" : "start"}
      role="article"
      aria-label={isUser ? "Your message" : "Assistant response"}
    >
      <MessageContent>
        <MessageHeader className="justify-between gap-3">
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {isUser ? "You" : message.modelId || modelId || "Assistant"}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            {!isUser && message.content ? (
              <ToggleGroup
                type="single"
                value={format}
                onValueChange={(value) => {
                  if (value === "md" || value === "text") {
                    setFormat(value)
                  }
                }}
                variant="outline"
                size="sm"
                className="h-7 gap-0"
                aria-label="Assistant message format"
              >
                <ToggleGroupItem
                  value="md"
                  aria-label="Format as markdown"
                  className="h-7 px-2 text-xs font-medium"
                >
                  MD
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="text"
                  aria-label="Format as plain text"
                  className="h-7 px-2 text-xs font-medium"
                >
                  Plain text
                </ToggleGroupItem>
              </ToggleGroup>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={isUser ? "Copy your message" : "Copy answer"}
              disabled={!message.content}
              onClick={() => copyMessageContent(message.content)}
            >
              <Copy />
            </Button>
          </div>
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
            {isUser || format === "text" ? (
              <BubbleContent
                className={cn(
                  "[overflow-wrap:anywhere] whitespace-pre-wrap",
                  !isUser &&
                    "font-mono text-xs sm:text-sm text-foreground/90 leading-relaxed"
                )}
              >
                {message.content}
              </BubbleContent>
            ) : (
              <BubbleContent className="[overflow-wrap:anywhere] max-w-full">
                <PlaygroundMarkdown content={message.content} />
              </BubbleContent>
            )}
          </Bubble>
        ) : null}
        <MessageFooter className="flex-col items-start gap-2">
          {message.runStatus || (message.isStreaming && !message.content) ? (
            <p
              role={message.error ? "alert" : "status"}
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
