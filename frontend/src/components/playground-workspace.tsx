import * as React from "react"
import {
  ArrowUp,
  KeyRound,
  MoreHorizontal,
  Plus,
  SlidersHorizontal,
  Square,
  ArrowUpRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import {
  InputGroup,
  InputGroupTextarea,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group"
import { Field, FieldLabel } from "@/components/ui/field"

export function PlaygroundToolbar({
  modelPicker,
  keyConnected,
  onKey,
  onSettings,
  onNew,
  canClear,
}: {
  modelPicker: React.ReactNode
  keyConnected: boolean
  onKey: () => void
  onSettings: () => void
  onNew: () => void
  canClear: boolean
}) {
  return (
    <header className="@container/toolbar flex shrink-0 items-center justify-between gap-2 border-b pb-3">
      <div className="min-w-0 flex-1">{modelPicker}</div>
      <div className="hidden shrink-0 items-center gap-1 @min-[720px]/toolbar:flex">
        <Button variant="ghost" size="sm" onClick={onKey}>
          <KeyRound data-icon="inline-start" />
          {keyConnected ? "Key connected" : "Connect key"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onSettings}>
          <SlidersHorizontal data-icon="inline-start" />
          Settings
        </Button>
        <Button variant="ghost" size="sm" onClick={onNew} disabled={!canClear}>
          <Plus data-icon="inline-start" />
          New conversation
        </Button>
      </div>
      <div className="@min-[720px]/toolbar:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Playground actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={onKey}>
                <KeyRound />
                {keyConnected ? "Manage connected key" : "Connect key"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onSettings}>
                <SlidersHorizontal />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onNew} disabled={!canClear}>
                <Plus />
                New conversation
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

const starters = [
  {
    label: "Explain a concept",
    prompt:
      "Explain the difference between SSE and WebSockets in simple terms.",
  },
  {
    label: "Write some code",
    prompt:
      "Write a Python function with type hints to calculate exponential backoff.",
  },
  {
    label: "Explore an idea",
    prompt:
      "Help me design a low-latency LLM gateway. What tradeoffs should I consider?",
  },
]

export function PlaygroundEmptyState({
  hasKey,
  hasModel,
  onConnect,
  onChooseModel,
  onPrompt,
}: {
  hasKey: boolean
  hasModel: boolean
  onConnect: () => void
  onChooseModel: () => void
  onPrompt: (prompt: string) => void
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="@container/prompts mx-auto flex min-h-full w-full max-w-[840px] flex-col justify-center gap-8 py-8 sm:py-12">
        <div className="flex flex-col items-start gap-4">
          <h2 className="text-3xl font-medium tracking-tight sm:text-4xl">
            What would you like to test?
          </h2>
          <p className="max-w-lg text-sm leading-6 text-muted-foreground">
            {!hasKey
              ? "Connect an API key, then choose a model to start a conversation."
              : !hasModel
                ? "Choose a model, then send your first message."
                : "Try a prompt, refine your instructions, and see how the model responds."}
          </p>
          {!hasKey ? (
            <Button onClick={onConnect}>
              <KeyRound data-icon="inline-start" />
              Connect key
            </Button>
          ) : !hasModel ? (
            <Button onClick={onChooseModel}>Choose a model</Button>
          ) : null}
        </div>
        <div
          className="grid gap-2 @min-[600px]/prompts:grid-cols-3"
          aria-label="Starter prompts"
        >
          {starters.map(({ label, prompt }) => (
            <Button
              key={label}
              variant="outline"
              className="h-auto min-h-12 justify-between gap-3 rounded-lg px-4 py-3 text-left whitespace-normal"
              onClick={() => onPrompt(prompt)}
            >
              {label}
              <ArrowUpRight data-icon="inline-end" />
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function PlaygroundComposer({
  ref,
  value,
  onChange,
  generating,
  onSend,
  onStop,
}: {
  ref: React.Ref<HTMLTextAreaElement>
  value: string
  onChange: (value: string) => void
  generating: boolean
  onSend: () => void
  onStop: () => void
}) {
  const composing = React.useRef(false)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSend()
      }}
    >
      <Field>
        <FieldLabel htmlFor="playground-prompt" className="sr-only">
          Message
        </FieldLabel>
        <InputGroup className="rounded-xl">
          <InputGroupTextarea
            ref={ref}
            id="playground-prompt"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            rows={2}
            onCompositionStart={() => {
              composing.current = true
            }}
            onCompositionEnd={() => {
              composing.current = false
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                !composing.current
              ) {
                event.preventDefault()
                if (!generating) onSend()
              }
            }}
            placeholder="Message the model…"
            aria-describedby="composer-help"
            className="max-h-[min(160px,24dvh)] min-h-16 resize-none"
          />
          <InputGroupAddon align="block-end">
            <p
              id="composer-help"
              className="min-w-0 flex-1 text-xs font-normal text-muted-foreground"
            >
              <span className="hidden sm:inline">
                Enter to send · Shift+Enter for a new line
              </span>
              <span className="sm:hidden">Enter to send</span>
            </p>
            {generating ? (
              <InputGroupButton
                variant="default"
                size="icon-sm"
                aria-label="Stop generation"
                onClick={onStop}
              >
                <Square />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                type="submit"
                variant="default"
                size="icon-sm"
                aria-label="Send message"
                disabled={!value.trim()}
              >
                <ArrowUp />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </Field>
    </form>
  )
}
