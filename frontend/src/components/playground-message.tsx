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

function copyMessageContent(text: string) {
  void navigator.clipboard.writeText(text)
  toast.success("Copied to clipboard.")
}

export const PlaygroundMessage = React.memo(function PlaygroundMessage({
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
