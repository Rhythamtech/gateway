import * as React from "react"
import { getMessageTrace, type MessageTraceDetail } from "@/lib/auth"

export type TraceDetailResult = {
  id: string
  tick: number
  trace?: MessageTraceDetail
  error?: string
}

/**
 * Loads a message trace by ID; re-runs whenever `tick` increments
 * (used as a manual "refresh" counter by the sheet and detail page).
 */
export function useTraceDetail(
  traceId: string | null,
  tick = 0
): TraceDetailResult | null {
  const [result, setResult] = React.useState<TraceDetailResult | null>(null)

  React.useEffect(() => {
    if (!traceId) return
    let cancelled = false
    getMessageTrace(traceId)
      .then((trace) => {
        if (!cancelled) setResult({ id: traceId, tick, trace })
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setResult({
            id: traceId,
            tick,
            error:
              error instanceof Error
                ? error.message
                : "Unable to load the trace.",
          })
      })
    return () => {
      cancelled = true
    }
  }, [traceId, tick])

  return result?.id === traceId && result.tick === tick ? result : null
}
