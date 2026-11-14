import { CornerDownRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
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
  TraceStatusBadge,
} from "./shared"

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
            <div className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={failed ? "destructive" : "outline"}>
                    Attempt #{index + 1}
                  </Badge>
                  <span className="text-base font-semibold break-all text-foreground">
                    {call.provider_model?.provider_name ?? "Provider"}
                    <span className="font-normal text-muted-foreground">
                      {" · "}
                      {call.provider_model?.model_id ?? "Unresolved Model"}
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

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  Started: {formatDateTime(call.created_at)}
                  {call.finished_at
                    ? ` · Finished: ${formatDateTime(call.finished_at)}`
                    : ""}
                </span>
                {call.error_code ? (
                  <Badge variant="destructive" className="font-mono text-xs">
                    Error: {call.error_code}
                  </Badge>
                ) : null}
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
