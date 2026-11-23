import type { ReactNode } from "react"
import { ArrowUpRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { formatDateTime, formatMs } from "@/components/traces/shared"
import { useTraceDetail } from "@/components/traces/use-trace-detail"
import type { CreditUsage } from "@/lib/auth"
import {
  creditReviewReason,
  formatCredits,
  formatTokenCount,
} from "@/lib/credits"

const attemptOutcome: Record<string, string> = {
  success: "Completed",
  failed: "Failed",
  timeout: "Timed out",
  pending: "No outcome recorded",
}

function FlowStep({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="relative flex flex-col gap-1 border-l pb-3 pl-4 before:absolute before:top-1.5 before:-left-[4.5px] before:size-2 before:rounded-full before:border before:border-background before:bg-muted-foreground last:pb-0">
      <h4 className="text-sm font-medium">{title}</h4>
      <div className="flex flex-col gap-1 text-xs wrap-anywhere text-muted-foreground">
        {children}
      </div>
    </li>
  )
}

export function CreditRequestFlow({ usage }: { usage: CreditUsage }) {
  const result = useTraceDetail(usage.request_id)
  const trace = result?.trace
  const requestedModel = trace?.request?.model
  const usageAvailable =
    usage.input_tokens !== null || usage.output_tokens !== null
  const completed = usage.status === "settled" || usage.status === "released"

  return (
    <section
      aria-label="Request flow"
      className="flex flex-col gap-3 rounded-md border p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Request flow</h3>
        {trace && (
          <Button asChild variant="outline" size="xs">
            <a
              href={`/dashboard/traces/detail?id=${encodeURIComponent(trace.id)}&tab=attempts`}
            >
              Open request trace
              <ArrowUpRight data-icon="inline-end" />
            </a>
          </Button>
        )}
      </div>
      <ol className="ml-1">
        <FlowStep title="Credits reserved">
          <p>
            {formatCredits(usage.reserved_credits)} credits held for the
            request.
          </p>
          <time dateTime={usage.created_at}>
            {formatDateTime(usage.created_at)}
          </time>
        </FlowStep>
        <FlowStep title="Provider routing">
          {typeof requestedModel === "string" && (
            <p>Requested model {requestedModel}</p>
          )}
          {typeof trace?.request?.stream === "boolean" && (
            <p>
              {trace.request.stream
                ? "Streaming request"
                : "Non-streaming request"}
            </p>
          )}
          {usage.model_id && <p>Selected route {usage.model_id}</p>}
          {trace?.calls.length ? (
            <ol
              aria-label="Provider attempts"
              className="mt-1 flex flex-col gap-1"
            >
              {trace.calls.map((call, index) => (
                <li key={call.id} className="rounded-md border px-2 py-1.5">
                  <p className="font-medium text-foreground">
                    Attempt {index + 1} ·{" "}
                    {attemptOutcome[call.status] ?? call.status}
                  </p>
                  {call.provider_model && (
                    <p>
                      {call.provider_model.provider_name} ·{" "}
                      {call.provider_model.model_id}
                    </p>
                  )}
                  <p>
                    <time dateTime={call.created_at}>
                      {formatDateTime(call.created_at)}
                    </time>
                    {call.latency_ms !== null && (
                      <span> · {formatMs(call.latency_ms)}</span>
                    )}
                  </p>
                  {call.error_code && <p>Error code {call.error_code}</p>}
                </li>
              ))}
            </ol>
          ) : (
            <p role="status">
              {!result
                ? "Loading provider trace…"
                : result.errorStatus === 404 || trace
                  ? "No provider attempts were recorded in a request trace."
                  : "The provider trace could not be loaded."}
            </p>
          )}
        </FlowStep>
        <FlowStep title="Token usage">
          {usageAvailable ? (
            <p>
              Input {formatTokenCount(usage.input_tokens)} · Output{" "}
              {formatTokenCount(usage.output_tokens)}
            </p>
          ) : (
            <p>No confirmed token counts in the credit record.</p>
          )}
        </FlowStep>
        <FlowStep
          title={
            usage.status === "needs_review"
              ? "Credit review required"
              : usage.status === "released"
                ? "Hold released"
                : usage.status === "settled"
                  ? "Usage settled"
                  : "Hold active"
          }
        >
          {usage.status === "needs_review" && (
            <p className="text-foreground">
              {creditReviewReason(usage.reason)}
            </p>
          )}
          {completed ? (
            <p>{formatCredits(usage.charged_credits)} credits charged.</p>
          ) : (
            <p>The charge has not been finalized.</p>
          )}
          {completed && usage.reason && <p>Resolution reason {usage.reason}</p>}
          <p>
            Last updated{" "}
            <time dateTime={usage.updated_at}>
              {formatDateTime(usage.updated_at)}
            </time>
          </p>
        </FlowStep>
      </ol>
    </section>
  )
}
