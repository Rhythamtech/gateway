import * as React from "react"
import { Copy, Code } from "lucide-react"
import { toast } from "sonner"
import type { RunSnapshot } from "@/lib/playground-stream"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export type InspectorProps = {
  status: string
  diagnostics: RunSnapshot | null
  request: string
  response: string
  model: string | undefined
  latencyMs: number | null
  tokensPerSec: number | null
  finishReason: string | null
  onExport: () => void
}

export default function PlaygroundInspector(props: InspectorProps) {
  const [tab, setTab] = React.useState("overview")
  const run = props.diagnostics
  const ms = (value: number | null | undefined) =>
    value == null ? "—" : `${value.toLocaleString()} ms`
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Copied to clipboard.")
    } catch {
      toast.error("Could not copy. Select and copy the text instead.")
    }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-4">
        <TabsList
          className="mx-4 flex w-auto shrink-0"
          aria-label="Run inspector views"
        >
          <TabsTrigger className="min-w-0 flex-1 px-2 text-xs" value="overview">
            Overview
          </TabsTrigger>
          <TabsTrigger className="min-w-0 flex-1 px-2 text-xs" value="request">
            Request JSON
          </TabsTrigger>
          <TabsTrigger className="min-w-0 flex-1 px-2 text-xs" value="response">
            Stream events
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="overview"
          className="min-h-0 overflow-y-auto px-4 pb-4"
        >
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium break-words">{props.status}</p>
              <p className="font-mono text-xs break-all text-muted-foreground">
                {props.model}
              </p>
            </div>
            {!props.request ? (
              <div className="flex flex-col gap-2 py-4">
                <h3 className="text-sm font-medium">No run yet</h3>
                <p className="text-sm text-muted-foreground">
                  Send a message to see response timing and token usage.
                </p>
              </div>
            ) : (
              <>
                <section
                  aria-label="Run timing"
                  className="flex flex-col gap-3"
                >
                  <h3 className="text-sm font-medium">Timing</h3>
                  <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-xs">
                    {[
                      ["Response headers", ms(run?.headersMs)],
                      ["First event", ms(run?.firstEventMs)],
                      ["First answer text", ms(run?.firstAnswerMs)],
                      ["Finish signal", ms(run?.completionMs)],
                      ["Terminal signal", ms(run?.terminalMs)],
                      ["Connection closed", ms(run?.closeMs)],
                      ["Total duration", ms(props.latencyMs)],
                    ].map(([label, value]) => (
                      <React.Fragment key={label}>
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="text-right font-mono tabular-nums">
                          {value}
                        </dd>
                      </React.Fragment>
                    ))}
                  </dl>
                  <p className="text-xs text-muted-foreground">
                    Times start at dispatch. First event may be a heartbeat or
                    reasoning; first answer counts answer text only.
                  </p>
                </section>
                <section
                  aria-label="Provider usage"
                  className="flex flex-col gap-3 border-t pt-4"
                >
                  <h3 className="text-sm font-medium">Provider usage</h3>
                  <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-xs">
                    {[
                      [
                        "Input tokens",
                        run?.usage?.promptTokens?.toLocaleString() ?? "—",
                      ],
                      [
                        "Output tokens",
                        run?.usage?.completionTokens?.toLocaleString() ?? "—",
                      ],
                      [
                        "Total tokens",
                        run?.usage?.totalTokens?.toLocaleString() ?? "—",
                      ],
                      [
                        "Output tokens / second",
                        props.tokensPerSec?.toLocaleString() ?? "—",
                      ],
                      ["Finish reason", props.finishReason ?? "—"],
                    ].map(([label, value]) => (
                      <React.Fragment key={label}>
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="max-w-36 text-right font-mono break-words tabular-nums">
                          {value}
                        </dd>
                      </React.Fragment>
                    ))}
                  </dl>
                  <p className="text-xs text-muted-foreground">
                    Speed uses provider output tokens over the whole request,
                    including thinking and transport. A dash means unavailable.
                  </p>
                </section>{" "}
              </>
            )}
          </div>
        </TabsContent>
        <TabsContent
          value="request"
          className="flex min-h-0 flex-col gap-3 px-4 pb-4"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Exact last-dispatched payload
            </p>
            <Button
              variant="ghost"
              size="sm"
              disabled={!props.request}
              onClick={() => void copy(props.request)}
            >
              <Copy data-icon="inline-start" />
              Copy JSON
            </Button>
          </div>
          <pre
            tabIndex={0}
            aria-label="Dispatched request JSON"
            className="min-h-0 flex-1 overflow-auto rounded-md bg-muted p-3 font-mono text-xs"
          >
            {props.request || "No request dispatched yet."}
          </pre>
        </TabsContent>
        <TabsContent
          value="response"
          className="flex min-h-0 flex-col gap-3 px-4 pb-4"
        >
          <p className="text-xs text-muted-foreground">
            Live events or JSON response. Latest 32 KiB; reasoning stays
            separate from the answer.
          </p>
          <pre
            tabIndex={0}
            aria-label="Live stream events or JSON response"
            className="min-h-0 flex-1 overflow-auto rounded-md bg-muted p-3 font-mono text-xs"
          >
            {props.response || "No response received yet."}
          </pre>
        </TabsContent>
      </Tabs>
      <div className="flex shrink-0 flex-wrap gap-2 border-t px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button variant="outline" size="sm" onClick={props.onExport}>
          <Code data-icon="inline-start" />
          Export request
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!props.response}
          onClick={() => void copy(props.response)}
        >
          <Copy data-icon="inline-start" />
          Copy response
        </Button>
      </div>
    </div>
  )
}
