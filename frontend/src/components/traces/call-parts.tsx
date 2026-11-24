import { ChevronDown, CircleAlert, CornerDownRight } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { CallTraceItem } from "@/lib/auth"
import {
  CopyButton,
  formatDateTime,
  formatInt,
  formatMs,
  shortId,
  TokenPair,
  TraceField,
  TraceStatusBadge,
} from "./shared"

function AttemptError({ call }: { call: CallTraceItem }) {
  const details = call.error_details
  const response = details?.provider_response
  const responseText =
    typeof response === "string"
      ? response
      : response == null
        ? null
        : JSON.stringify(response, null, 2)
  const providerIdentifiers = [
    ...new Set(
      [details?.provider_type, details?.provider_code].filter(Boolean)
    ),
  ].join(" · ")
  const status = [
    details?.provider_status && `Upstream HTTP ${details.provider_status}`,
    details?.gateway_status &&
      details.gateway_status !== details.provider_status &&
      `Gateway HTTP ${details.gateway_status}`,
  ]
    .filter(Boolean)
    .join(" · ")
  const summary =
    details?.provider_message ??
    details?.message ??
    (call.status === "timeout"
      ? "The attempt timed out."
      : "The attempt failed.")
  const visibleSummary =
    responseText !== null && summary.length > 360
      ? `${summary.slice(0, 360)}…`
      : summary
  const responseUnavailable = details
    ? details.provider_status && "Provider response body unavailable."
    : "No error details were recorded for this attempt."

  return (
    <Alert variant="destructive" role="group" aria-label="Attempt failure">
      <CircleAlert aria-hidden="true" />
      <AlertDescription className="min-w-0 gap-3">
        <p className="wrap-anywhere whitespace-pre-wrap">{visibleSummary}</p>
        {status ||
        details?.operation ||
        providerIdentifiers ||
        call.error_code ? (
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            {status ? <TraceField label="Status">{status}</TraceField> : null}
            {details?.operation ? (
              <TraceField label="Operation" mono>
                {details.operation}
              </TraceField>
            ) : null}
            {providerIdentifiers || call.error_code ? (
              <TraceField
                label={providerIdentifiers ? "Provider error" : "Gateway error"}
                mono
              >
                {providerIdentifiers || call.error_code}
              </TraceField>
            ) : null}
          </dl>
        ) : null}
        {responseText !== null ? (
          <Collapsible className="grid w-full min-w-0 gap-2">
            <CollapsibleTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="group justify-self-start"
              >
                Provider response
                <ChevronDown
                  data-icon="inline-end"
                  className="group-data-[state=open]:rotate-180"
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="min-w-0">
              <div className="flex justify-end">
                <CopyButton value={responseText} label="Copy response" />
              </div>
              <pre
                tabIndex={0}
                aria-label="Provider response body"
                className="max-h-80 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs wrap-anywhere whitespace-pre-wrap text-foreground"
              >
                {responseText}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        ) : responseUnavailable ? (
          <p className="text-xs text-muted-foreground">{responseUnavailable}</p>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

export function AttemptTimeline({ calls }: { calls: CallTraceItem[] }) {
  if (!calls.length) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        No provider attempts recorded. The request may have stopped or was
        rejected before an upstream provider was resolved.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {calls.map((call, index) => {
        const failed = call.status === "failed" || call.status === "timeout"
        const isNotLast = index < calls.length - 1

        return (
          <div key={call.id} className="flex flex-col gap-3">
            <div className="flex min-w-0 flex-col gap-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={failed ? "destructive" : "outline"}>
                    Attempt #{index + 1}
                  </Badge>
                  <span className="text-base font-semibold break-all text-foreground">
                    {call.provider_model?.provider_name ?? "Provider"}
                    <span className="font-normal text-muted-foreground">
                      {" · "}
                      {call.error_details?.upstream_model ??
                        call.provider_model?.model_id ??
                        "Unresolved Model"}
                    </span>
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="tabular-nums">
                    {formatMs(call.latency_ms)}
                  </Badge>
                  <TraceStatusBadge status={call.status} />
                </div>
              </div>

              {failed ? <AttemptError call={call} /> : null}

              <div className="text-xs text-muted-foreground">
                <span>
                  Started: {formatDateTime(call.created_at)}
                  {call.finished_at
                    ? ` · Finished: ${formatDateTime(call.finished_at)}`
                    : ""}
                </span>
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider Alias</TableHead>
                      <TableHead>Gateway Model</TableHead>
                      <TableHead>Tokens (In / Out)</TableHead>
                      <TableHead>Cache Tokens</TableHead>
                      <TableHead>Cache (Read / Write)</TableHead>
                      <TableHead className="w-28 text-right">Call ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-mono text-xs">
                        {call.provider_model?.provider_alias ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {call.gateway_model?.model_id ?? "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        <TokenPair
                          input={call.input_tokens}
                          output={call.output_tokens}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">
                        {formatInt(call.cache_tokens)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        <TokenPair
                          input={call.cache_read_tokens}
                          output={call.cache_write_tokens}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <span className="font-mono text-xs">
                            {shortId(call.id)}
                          </span>
                          <CopyButton
                            value={call.id}
                            label="Copy Call ID"
                            iconOnly
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>

            {isNotLast ? (
              <div className="flex items-center gap-2 pl-4 text-xs font-medium text-muted-foreground">
                <CornerDownRight className="size-4 text-muted-foreground" />
                <span>Failover routed to next provider attempt</span>
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
