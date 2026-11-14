import * as React from "react"
import { ArrowLeft, RefreshCw } from "lucide-react"
import { PageContent } from "@/components/dashboard-shell"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { requestModel, shortId, TraceEmpty } from "./shared"
import { TraceOverview } from "./overview"
import { useTraceDetail } from "./use-trace-detail"

export function TraceDetailContent() {
  const [traceId] = React.useState(() =>
    new URLSearchParams(window.location.search).get("id")
  )
  const [tick, setTick] = React.useState(0)
  const result = useTraceDetail(traceId, tick)
  const trace = result?.trace
  const modelName = trace ? requestModel(trace.request) : null

  return (
    <PageContent>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        {/* Navigation & Actions Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button asChild variant="outline" size="sm">
              <a href="/dashboard/traces">
                <ArrowLeft data-icon="inline-start" />
                Back to Request Traces
              </a>
            </Button>
            <Breadcrumb className="hidden sm:block">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink href="/dashboard/traces">
                    Request Traces
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>
                    {modelName ?? (traceId ? shortId(traceId) : "Details")}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>

          {traceId ? (
            <Button
              variant="outline"
              size="sm"
              disabled={!result}
              onClick={() => setTick((value) => value + 1)}
            >
              <RefreshCw data-icon="inline-start" />
              Refresh
            </Button>
          ) : null}
        </div>

        {!traceId ? (
          <TraceEmpty
            title="No trace specified"
            description="Provide a trace ID or open a record from the Request Traces table."
            action={
              <Button asChild variant="outline" size="sm">
                <a href="/dashboard/traces">Browse Traces</a>
              </Button>
            }
          />
        ) : result?.error ? (
          <TraceEmpty
            error
            title="Unable to load the trace"
            description={result.error}
            action={
              <Button onClick={() => setTick((value) => value + 1)}>
                Try again
              </Button>
            }
          />
        ) : trace ? (
          <TraceOverview trace={trace} />
        ) : (
          <div
            className="flex flex-col gap-8"
            role="status"
            aria-label="Loading trace"
          >
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-6 w-24" />
              </div>
              <Skeleton className="h-9 w-72" />
              <Skeleton className="h-4 w-96" />
            </div>

            <div className="grid grid-cols-2 gap-6 border-y py-4 sm:grid-cols-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>

            <div className="flex flex-col gap-3">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-48 w-full" />
            </div>
          </div>
        )}
      </div>
    </PageContent>
  )
}
