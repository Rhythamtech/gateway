"use client"

import * as React from "react"
import { Check, Copy, Terminal } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

function codeExamples(origin: string) {
  return {
    python: `from openai import OpenAI

# 1. Point official OpenAI SDK to your Gateway endpoint
client = OpenAI(
    base_url="${origin}/v1",
    api_key="gw-live-your_api_key_here",
)

# 2. Access any model (Google, Anthropic, Meta, Mistral)
response = client.chat.completions.create(
    model="google/gemma-4-31b",
    messages=[
        {"role": "system", "content": "You are a production AI assistant."},
        {"role": "user", "content": "How does Gateway handle provider failover?"},
    ],
    temperature=0.7,
)

print(response.choices[0].message.content)`,

    typescript: `import Anthropic from "@anthropic-ai/sdk"

// 1. Point official Anthropic SDK to your Gateway endpoint
const client = new Anthropic({
  baseURL: "${origin}/v1",
  apiKey: "gw-live-your_api_key_here",
})

// 2. Stream responses with zero data retention
const stream = await client.messages.create({
  model: "claude-3-5-sonnet",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Explain atomic token reservations." }],
  stream: true,
})

for await (const chunk of stream) {
  process.stdout.write(chunk.delta?.text || "")
}`,

    curl: `curl -X POST ${origin}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer gw-live-your_api_key_here" \\
  -d '{
    "model": "google/gemma-4-31b",
    "messages": [
      {"role": "user", "content": "Ping gateway"}
    ],
    "stream": false
  }'`,
  }
}

export function LandingCodePreview() {
  const [activeTab, setActiveTab] = React.useState<
    "python" | "typescript" | "curl"
  >("python")
  const [copied, setCopied] = React.useState(false)
  const origin = React.useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => ""
  )

  const examples = codeExamples(origin)

  const handleCopy = () => {
    navigator.clipboard.writeText(examples[activeTab])
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card className="overflow-hidden border-border/80 bg-card/60 shadow-md backdrop-blur-xs">
      <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Terminal className="size-4 text-muted-foreground" />
          <CardTitle className="font-mono text-xs font-medium text-foreground">
            Drop-in SDK Integration
          </CardTitle>
          <Badge variant="outline" className="px-2 py-0 font-mono text-[10px]">
            Zero Client Changes
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="xs"
          onClick={handleCopy}
          className="h-7 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {copied ? (
            <>
              <Check className="size-3 text-emerald-500" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="size-3" />
              <span>Copy</span>
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Tabs
          value={activeTab}
          onValueChange={(val) => setActiveTab(val as typeof activeTab)}
          className="w-full"
        >
          <div className="border-b border-border/50 bg-muted/20 px-4 py-2">
            <TabsList className="h-7 bg-muted/60 p-0.5">
              <TabsTrigger value="python" className="px-2.5 py-1 text-xs">
                Python (OpenAI)
              </TabsTrigger>
              <TabsTrigger value="typescript" className="px-2.5 py-1 text-xs">
                TypeScript (Anthropic)
              </TabsTrigger>
              <TabsTrigger value="curl" className="px-2.5 py-1 text-xs">
                cURL
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="python" className="m-0 p-4">
            <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-foreground/90 selection:bg-primary/20">
              <code>{examples.python}</code>
            </pre>
          </TabsContent>

          <TabsContent value="typescript" className="m-0 p-4">
            <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-foreground/90 selection:bg-primary/20">
              <code>{examples.typescript}</code>
            </pre>
          </TabsContent>

          <TabsContent value="curl" className="m-0 p-4">
            <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-foreground/90 selection:bg-primary/20">
              <code>{examples.curl}</code>
            </pre>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
