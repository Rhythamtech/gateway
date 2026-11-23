"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const configuredOrigin = import.meta.env.PUBLIC_API_BASE_URL
const localOrigin = "http://localhost:8000"
const placeholderOrigin = configuredOrigin ?? localOrigin

function getOrigin() {
  return (
    configuredOrigin ??
    (import.meta.env.DEV ? localOrigin : window.location.origin)
  )
}

function codeExamples(origin: string) {
  const base = origin.replace(/\/$/, "")
  return {
    python: `from openai import OpenAI

client = OpenAI(
    base_url="${base}/v1",
    api_key="YOUR_GATEWAY_API_KEY",
)

response = client.chat.completions.create(
    model="YOUR_MODEL_ID",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)`,
    typescript: `import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({
  baseURL: "${base}",
  apiKey: "YOUR_GATEWAY_API_KEY",
})

const response = await client.messages.create({
  model: "YOUR_MODEL_ID",
  max_tokens: 128,
  messages: [{ role: "user", content: "Hello!" }],
})
console.log(response.content)`,
    curl: `curl "${base}/v1/chat/completions" \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer YOUR_GATEWAY_API_KEY' \\
  -d '{
    "model": "YOUR_MODEL_ID",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'`,
  }
}

const tabs = [
  { id: "python", label: "OpenAI" },
  { id: "typescript", label: "Anthropic" },
  { id: "curl", label: "cURL" },
] as const

export function LandingCodePreview() {
  const [activeTab, setActiveTab] =
    React.useState<(typeof tabs)[number]["id"]>("python")
  const [copyStatus, setCopyStatus] = React.useState<
    "idle" | "copied" | "error"
  >("idle")
  const origin = React.useSyncExternalStore(
    () => () => {},
    getOrigin,
    () => placeholderOrigin
  )
  const examples = codeExamples(origin)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(examples[activeTab])
      setCopyStatus("copied")
    } catch {
      setCopyStatus("error")
    }
  }

  return (
    <Card className="gap-0 overflow-hidden rounded-xl border-border bg-muted py-0 text-foreground shadow-none">
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <CardTitle className="text-sm font-medium">Send a request</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="text-muted-foreground"
        >
          Copy code
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            setActiveTab(value as typeof activeTab)
            setCopyStatus("idle")
          }}
          className="gap-0"
        >
          <div className="border-b border-border px-4 sm:px-6">
            <TabsList variant="line" aria-label="API examples">
              {tabs.map(({ id, label }) => (
                <TabsTrigger
                  key={id}
                  value={id}
                  className="text-xs text-muted-foreground after:bg-primary"
                >
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {tabs.map(({ id, label }) => (
            <TabsContent key={id} value={id} className="min-w-0">
              <pre
                tabIndex={0}
                aria-label={`${label} code example`}
                className="min-h-68 px-4 py-5 font-mono text-xs leading-5 wrap-anywhere whitespace-pre-wrap text-foreground sm:min-h-76 sm:px-6 sm:text-[13px]"
              >
                <code>{examples[id]}</code>
              </pre>
            </TabsContent>
          ))}
        </Tabs>
        <p
          role="status"
          className="min-h-9 border-t border-border px-4 py-2 text-xs text-muted-foreground sm:px-6"
        >
          {copyStatus === "copied"
            ? "Copied to clipboard."
            : copyStatus === "error"
              ? "Select the code to copy it."
              : "Use your API key and model ID."}
        </p>
      </CardContent>
    </Card>
  )
}
