"use client"

import * as React from "react"
import { toast } from "sonner"
import { Check, Copy, Cpu, Layers, ShieldCheck } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const sections = [
  { id: "quickstart", title: "Quickstart" },
  { id: "authentication", title: "Authentication" },
  { id: "models", title: "Models and routing" },
  { id: "chat-completions", title: "Chat completions" },
  { id: "anthropic-messages", title: "Anthropic messages" },
  { id: "streaming", title: "Streaming" },
  { id: "errors", title: "Error codes" },
]

function subscribeToHash(callback: () => void) {
  window.addEventListener("hashchange", callback)
  return () => window.removeEventListener("hashchange", callback)
}

const configuredOrigin = import.meta.env.PUBLIC_API_BASE_URL
const localOrigin = "http://localhost:8000"

export function DocsView() {
  const activeSection = React.useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash.slice(1) || "quickstart",
    () => "quickstart"
  )
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null)
  const origin = React.useSyncExternalStore(
    () => () => {},
    () =>
      configuredOrigin ??
      (import.meta.env.DEV ? localOrigin : window.location.origin),
    () => configuredOrigin ?? localOrigin
  )
  const clientOrigin = origin.replace(/\/$/, "")

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      toast.error("Could not copy. Select the text to copy it manually.")
      return
    }

    setCopiedKey(id)
    setTimeout(() => {
      setCopiedKey(null)
    }, 2000)
  }

  const gatewayV1Url = `${clientOrigin}/v1`

  return (
    <TooltipProvider delayDuration={150}>
      <div className="docs-page min-h-screen bg-background text-foreground [--docs-content-top:7.5rem] lg:[--docs-content-top:4.5rem]">
        <header className="sticky top-0 z-20 border-b border-border bg-background">
          <div className="public-width flex h-14 items-center justify-between gap-3">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink href="/">Home</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Docs</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>

            <div className="flex items-center gap-3">
              <a
                href="/support"
                className="text-sm font-medium underline-offset-4 hover:underline"
              >
                Support
              </a>
              <a
                href="/dashboard/playground"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Playground
              </a>
            </div>
          </div>
          <nav
            aria-label="Documentation sections"
            className="docs-mobile-nav flex h-12 items-center gap-2 overflow-x-auto px-5"
          >
            {sections.map(({ id, title }) => (
              <a
                key={id}
                href={`#${id}`}
                data-astro-reload
                aria-current={activeSection === id ? "location" : undefined}
                className={cn(
                  "shrink-0 rounded-md px-3 py-2 text-xs font-medium",
                  activeSection === id
                    ? "bg-muted text-primary"
                    : "text-muted-foreground"
                )}
              >
                {title}
              </a>
            ))}
          </nav>
        </header>

        <div className="public-width docs-layout grid gap-10 py-10">
          <aside className="docs-sidebar">
            <nav
              aria-label="Documentation sections"
              className="sticky top-20 grid gap-2 border-l border-border"
            >
              {sections.map(({ id, title }) => (
                <a
                  key={id}
                  href={`#${id}`}
                  data-astro-reload
                  aria-current={activeSection === id ? "location" : undefined}
                  className={cn(
                    "-ml-px border-l-2 border-transparent py-2 pr-3 pl-4 text-sm font-medium hover:text-primary",
                    activeSection === id
                      ? "border-l-primary bg-muted text-primary"
                      : "text-muted-foreground"
                  )}
                >
                  {title}
                </a>
              ))}
              <a
                href="/dashboard/api-keys"
                className="mt-2 pl-4 text-sm font-medium text-primary underline underline-offset-4"
              >
                Create an API key
              </a>
            </nav>
          </aside>

          <main className="min-w-0 space-y-12">
            {/* SECTION: Quickstart */}
            <section id="quickstart" className="scroll-mt-24 space-y-4">
              <div className="space-y-1">
                <h1 className="public-title font-semibold">Quickstart</h1>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Create a Gateway API key and use a configured model ID in your
                  first request.
                </p>
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between text-sm font-semibold">
                    <span>Base URL</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs"
                          onClick={() =>
                            copyToClipboard(gatewayV1Url, "base-url")
                          }
                        >
                          {copiedKey === "base-url" ? (
                            <Check className="h-3.5 w-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                          Copy
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Copy base URL</TooltipContent>
                    </Tooltip>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Set this as the <code>baseURL</code> in your SDK client of
                    choice.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="rounded-lg border bg-muted p-3 font-mono text-xs text-foreground select-all">
                    {gatewayV1Url}
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold">
                  Make Your First Request
                </h3>
                <Tabs defaultValue="python" className="w-full">
                  <TabsList
                    variant="line"
                    className="w-full justify-start rounded-none border-b px-0"
                  >
                    <TabsTrigger value="python" className="text-xs">
                      Python (OpenAI SDK)
                    </TabsTrigger>
                    <TabsTrigger value="typescript" className="text-xs">
                      TypeScript (Node.js)
                    </TabsTrigger>
                    <TabsTrigger value="curl" className="text-xs">
                      cURL
                    </TabsTrigger>
                  </TabsList>

                  {/* Python */}
                  <TabsContent value="python" className="mt-3 space-y-2">
                    <div className="relative overflow-x-auto rounded-lg border bg-muted p-4 font-mono text-xs leading-relaxed text-foreground">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="absolute top-3 right-3 h-7 gap-1 px-2 text-xs opacity-90 hover:opacity-100"
                        onClick={() =>
                          copyToClipboard(
                            `from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${gatewayV1Url}",\n    api_key="gw_your_api_key_here"\n)\n\nresponse = client.chat.completions.create(\n    model="openai/gpt-4o-mini",\n    messages=[{"role": "user", "content": "Explain quantum computing in one sentence."}]\n)\n\nprint(response.choices[0].message.content)`,
                            "py-quickstart"
                          )
                        }
                      >
                        {copiedKey === "py-quickstart" ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        Copy
                      </Button>
                      <pre>
                        {`from openai import OpenAI

client = OpenAI(
    base_url="${gatewayV1Url}",
    api_key="gw_your_api_key_here"  # From Dashboard > API Keys
)

response = client.chat.completions.create(
    model="openai/gpt-4o-mini",
    messages=[{"role": "user", "content": "Explain quantum computing in one sentence."}]
)

print(response.choices[0].message.content)`}
                      </pre>
                    </div>
                  </TabsContent>

                  {/* TypeScript */}
                  <TabsContent value="typescript" className="mt-3 space-y-2">
                    <div className="relative overflow-x-auto rounded-lg border bg-muted p-4 font-mono text-xs leading-relaxed text-foreground">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="absolute top-3 right-3 h-7 gap-1 px-2 text-xs opacity-90 hover:opacity-100"
                        onClick={() =>
                          copyToClipboard(
                            `import OpenAI from "openai";\n\nconst client = new OpenAI({\n  baseURL: "${gatewayV1Url}",\n  apiKey: "gw_your_api_key_here",\n});\n\nasync function main() {\n  const completion = await client.chat.completions.create({\n    model: "openai/gpt-4o-mini",\n    messages: [{ role: "user", content: "Hello Gateway!" }],\n  });\n\n  console.log(completion.choices[0].message.content);\n}\n\nmain();`,
                            "ts-quickstart"
                          )
                        }
                      >
                        {copiedKey === "ts-quickstart" ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        Copy
                      </Button>
                      <pre>
                        {`import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${gatewayV1Url}",
  apiKey: "gw_your_api_key_here", // From Dashboard > API Keys
});

async function main() {
  const completion = await client.chat.completions.create({
    model: "openai/gpt-4o-mini",
    messages: [{ role: "user", content: "Hello Gateway!" }],
  });

  console.log(completion.choices[0].message.content);
}

main();`}
                      </pre>
                    </div>
                  </TabsContent>

                  {/* cURL */}
                  <TabsContent value="curl" className="mt-3 space-y-2">
                    <div className="relative overflow-x-auto rounded-lg border bg-muted p-4 font-mono text-xs leading-relaxed text-foreground">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="absolute top-3 right-3 h-7 gap-1 px-2 text-xs opacity-90 hover:opacity-100"
                        onClick={() =>
                          copyToClipboard(
                            `curl ${gatewayV1Url}/chat/completions \\\n  -H "Authorization: Bearer gw_your_api_key_here" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "openai/gpt-4o-mini",\n    "messages": [{"role": "user", "content": "Hello!"}]\n  }'`,
                            "curl-quickstart"
                          )
                        }
                      >
                        {copiedKey === "curl-quickstart" ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        Copy
                      </Button>
                      <pre>
                        {`curl ${gatewayV1Url}/chat/completions \\
  -H "Authorization: Bearer gw_your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`}
                      </pre>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </section>

            <Separator />

            {/* SECTION: Authentication */}
            <section id="authentication" className="scroll-mt-24 space-y-4">
              <div className="space-y-1">
                <h2 className="text-2xl font-semibold tracking-tight">
                  Authentication
                </h2>
                <p className="text-sm text-muted-foreground">
                  Authenticate API requests using standard HTTP Bearer tokens.
                </p>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">
                    Authorization Header
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Every request to <code>/v1/*</code> must include your secret
                    API key in the Authorization header.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded-lg border bg-muted p-3 font-mono text-xs">
                    Authorization: Bearer gw_live_xxxxxxxxxxxxxxxxxxxx
                  </div>

                  <div className="space-y-1 rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-200">
                    <p className="flex items-center gap-1.5 font-semibold">
                      <ShieldCheck className="h-4 w-4" />
                      Key Protection Rules
                    </p>
                    <p className="leading-relaxed">
                      Never expose your Gateway API key in client-side
                      applications (such as React or mobile apps). Always call
                      the Gateway from your backend service or serverless
                      functions.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </section>

            <Separator />

            {/* SECTION: Models & Routing */}
            <section id="models" className="scroll-mt-24 space-y-4">
              <div className="space-y-1">
                <h2 className="text-2xl font-semibold tracking-tight">
                  Models & Addressing
                </h2>
                <p className="text-sm text-muted-foreground">
                  Access upstream models from multiple providers using
                  provider-qualified IDs or unified Model Groups.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Cpu className="h-4 w-4 text-primary" />
                      Provider-Qualified IDs
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs text-muted-foreground">
                    <p>
                      Format: <code>{"{provider_alias}/{upstream_model}"}</code>
                    </p>
                    <ul className="list-inside list-disc space-y-1 font-mono text-[11px] text-foreground">
                      <li>openai/gpt-4o</li>
                      <li>openai/gpt-4o-mini</li>
                      <li>anthropic/claude-3-5-sonnet</li>
                      <li>groq/llama-3.3-70b-versatile</li>
                    </ul>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Layers className="h-4 w-4 text-primary" />
                      Model Groups (Failovers)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs text-muted-foreground">
                    <p>
                      Model Groups group multiple models under one identifier.
                      If the primary model encounters a 5xx error or rate limit,
                      Gateway automatically fails over to the next configured
                      fallback model.
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">
                    Listing Available Models
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Send a <code>GET</code> request to <code>/v1/models</code>{" "}
                    to inspect all currently available models for your account.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto rounded-lg border bg-muted p-3 font-mono text-xs text-foreground">
                    <pre>{`curl ${gatewayV1Url}/models \\
  -H "Authorization: Bearer gw_your_api_key_here"`}</pre>
                  </div>
                </CardContent>
              </Card>
            </section>

            <Separator />

            {/* SECTION: Chat Completions */}
            <section id="chat-completions" className="scroll-mt-24 space-y-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="default">POST</Badge>
                  <span className="font-mono text-xs text-muted-foreground">
                    /v1/chat/completions
                  </span>
                </div>
                <h2 className="text-2xl font-semibold tracking-tight">
                  Chat Completions
                </h2>
                <p className="text-sm text-muted-foreground">
                  OpenAI-compatible chat completion endpoint supporting
                  multi-turn conversations, tool calling, and structured
                  parameters.
                </p>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Request Parameters</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[140px] text-xs">
                          Parameter
                        </TableHead>
                        <TableHead className="w-[90px] text-xs">Type</TableHead>
                        <TableHead className="text-xs">Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="text-xs">
                      <TableRow>
                        <TableCell className="font-mono font-medium">
                          model
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            string
                          </Badge>
                        </TableCell>
                        <TableCell>
                          Required. Model ID or model group alias (e.g.{" "}
                          <code>openai/gpt-4o</code>).
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono font-medium">
                          messages
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            array
                          </Badge>
                        </TableCell>
                        <TableCell>
                          Required. List of message objects with{" "}
                          <code>role</code> and <code>content</code>.
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono font-medium">
                          temperature
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            number
                          </Badge>
                        </TableCell>
                        <TableCell>
                          Optional. Sampling temperature between 0.0 and 2.0
                          (defaults to 1.0).
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono font-medium">
                          stream
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            boolean
                          </Badge>
                        </TableCell>
                        <TableCell>
                          Optional. If <code>true</code>, partial message deltas
                          will be sent as Server-Sent Events (SSE).
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono font-medium">
                          max_tokens
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            integer
                          </Badge>
                        </TableCell>
                        <TableCell>
                          Optional. Maximum tokens generated in the completion
                          response.
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </section>

            <Separator />

            {/* SECTION: Anthropic Messages */}
            <section id="anthropic-messages" className="scroll-mt-24 space-y-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="default">POST</Badge>
                  <span className="font-mono text-xs text-muted-foreground">
                    /v1/messages
                  </span>
                </div>
                <h2 className="text-2xl font-semibold tracking-tight">
                  Anthropic Messages Protocol
                </h2>
                <p className="text-sm text-muted-foreground">
                  Native compatibility with Anthropic’s wire protocol. Point the
                  official Anthropic SDK directly at the Gateway.
                </p>
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">
                    Anthropic Python SDK Example
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="relative overflow-x-auto rounded-lg border bg-muted p-4 font-mono text-xs leading-relaxed text-foreground">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="absolute top-3 right-3 h-7 gap-1 px-2 text-xs opacity-90 hover:opacity-100"
                      onClick={() =>
                        copyToClipboard(
                          `import anthropic\n\nclient = anthropic.Anthropic(\n    base_url="${clientOrigin}",\n    api_key="gw_your_api_key_here"\n)\n\nmessage = client.messages.create(\n    model="anthropic/claude-3-5-sonnet",\n    max_tokens=1024,\n    messages=[{"role": "user", "content": "Hello Claude!"}]\n)\n\nprint(message.content[0].text)`,
                          "anthropic-py"
                        )
                      }
                    >
                      {copiedKey === "anthropic-py" ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      Copy
                    </Button>
                    <pre>
                      {`import anthropic

client = anthropic.Anthropic(
    base_url="${clientOrigin}",
    api_key="gw_your_api_key_here"
)

message = client.messages.create(
    model="anthropic/claude-3-5-sonnet",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello Claude!"}]
)

print(message.content[0].text)`}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            </section>

            <Separator />

            {/* SECTION: Streaming */}
            <section id="streaming" className="scroll-mt-24 space-y-4">
              <div className="space-y-1">
                <h2 className="text-2xl font-semibold tracking-tight">
                  Streaming (SSE)
                </h2>
                <p className="text-sm text-muted-foreground">
                  Set <code>"stream": true</code> to receive tokens as
                  Server-Sent Events.
                </p>
              </div>

              <Card>
                <CardContent className="pt-6">
                  <div className="overflow-x-auto rounded-lg border bg-muted p-4 font-mono text-xs leading-relaxed text-foreground">
                    <pre>
                      {`stream = client.chat.completions.create(
    model="openai/gpt-4o-mini",
    messages=[{"role": "user", "content": "Stream a short haiku."}],
    stream=True,
)

for chunk in stream:
    token = chunk.choices[0].delta.content or ""
    print(token, end="", flush=True)`}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            </section>

            <Separator />

            {/* SECTION: Error Reference */}
            <section id="errors" className="scroll-mt-24 space-y-4">
              <div className="space-y-1">
                <h2 className="text-2xl font-semibold tracking-tight">
                  Error Reference
                </h2>
                <p className="text-sm text-muted-foreground">
                  Standardized error codes conforming to OpenAI wire
                  specifications.
                </p>
              </div>

              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[100px] text-xs">
                          Status
                        </TableHead>
                        <TableHead className="w-[180px] text-xs">
                          Error Code
                        </TableHead>
                        <TableHead className="text-xs">
                          Description & Recommended Fix
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="text-xs">
                      <TableRow>
                        <TableCell className="font-mono font-medium">
                          401
                        </TableCell>
                        <TableCell className="font-mono text-destructive">
                          invalid_api_key
                        </TableCell>
                        <TableCell>
                          API key is invalid, revoked, or missing. Check your{" "}
                          <code>Authorization: Bearer</code> header.
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono font-medium">
                          402 / 429
                        </TableCell>
                        <TableCell className="font-mono text-destructive">
                          insufficient_quota
                        </TableCell>
                        <TableCell>
                          Quota exceeded or balance is depleted. Check your
                          quota allotment.
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono font-medium">
                          404
                        </TableCell>
                        <TableCell className="font-mono text-destructive">
                          model_not_found
                        </TableCell>
                        <TableCell>
                          Model ID does not exist or provider is disabled. Check
                          available models via <code>/v1/models</code>.
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono font-medium">
                          429
                        </TableCell>
                        <TableCell className="font-mono text-destructive">
                          rate_limit_exceeded
                        </TableCell>
                        <TableCell>
                          Exceeded the sliding window rate limit. Implement
                          exponential backoff.
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-mono font-medium">
                          502 / 504
                        </TableCell>
                        <TableCell className="font-mono text-destructive">
                          upstream_error
                        </TableCell>
                        <TableCell>
                          Upstream provider timed out or failed. Switch to a
                          Model Group for automatic retry failover.
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </section>
          </main>
        </div>
      </div>
    </TooltipProvider>
  )
}
