import {
  PlaygroundMessage,
  type ChatMessage,
} from "@/components/playground-message"
import {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
} from "@/components/ui/message-scroller"

export function PlaygroundConversation({
  conversationId,
  messages,
  modelId,
  generating,
  canRetry,
  onRetry,
}: {
  conversationId: number
  messages: ChatMessage[]
  modelId: string
  generating: boolean
  canRetry: boolean
  onRetry: () => void
}) {
  const lastMessageId = messages.at(-1)?.id
  return (
    <MessageScrollerProvider key={conversationId} autoScroll>
      <MessageScroller>
        <MessageScrollerViewport
          aria-label="Conversation messages"
          role="region"
          tabIndex={0}
        >
          <MessageScrollerContent className="mx-auto w-full max-w-[840px] gap-8 py-6 sm:py-8">
            {messages.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.role === "user"}
              >
                <PlaygroundMessage
                  message={message}
                  modelId={modelId}
                  onRetry={
                    !generating &&
                    !message.isStreaming &&
                    (message.error || message.runStatus === "Stopped") &&
                    message.id === lastMessageId &&
                    canRetry
                      ? onRetry
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
  )
}
