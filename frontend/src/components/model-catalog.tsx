import * as React from "react"
import { Copy } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  listModelCatalog,
  type CatalogModel,
  type CatalogRateRange,
  type ModelCatalog,
} from "@/lib/auth"
import { formatCredits } from "@/lib/credits"

const PAGE_SIZE = 25
const compactCredits = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 2,
})
const STATUS_LABEL: Record<CatalogModel["status"], string> = {
  ready: "Ready",
  rate_needed: "Rate needed",
  unavailable: "Unavailable",
}

function formatRange(
  range: CatalogRateRange | null,
  format: (value: string) => string
) {
  if (!range) return "—"
  const min = format(range.min)
  const max = format(range.max)
  return min === max ? min : `${min}–${max}`
}

function formatEstimatedCredits(value: string) {
  const amount = Number(value)
  return amount >= 1_000 ? compactCredits.format(amount) : formatCredits(value)
}

async function copyModelId(modelId: string) {
  try {
    await navigator.clipboard.writeText(modelId)
    toast.success("Model ID copied.")
  } catch {
    toast.error("Could not copy the model ID. You can select and copy it.")
  }
}

export function ModelCatalogContent() {
  const [catalog, setCatalog] = React.useState<ModelCatalog | null>(null)
  const [error, setError] = React.useState(false)
  const [revision, reload] = React.useReducer((value: number) => value + 1, 0)
  const [search, setSearch] = React.useState("")
  const [page, setPage] = React.useState(1)

  React.useEffect(() => {
    let active = true
    listModelCatalog()
      .then((result) => {
        if (active) setCatalog(result)
      })
      .catch(() => {
        if (active) setError(true)
      })
    return () => {
      active = false
    }
  }, [revision])

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          The model catalog could not be loaded.
          <Button
            variant="link"
            onClick={() => {
              setError(false)
              reload()
            }}
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (!catalog) {
    return (
      <div role="status">
        <span className="sr-only">Loading models</span>
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  const query = search.trim().toLowerCase()
  const models = catalog.models.filter(
    (model) =>
      model.name.toLowerCase().includes(query) ||
      model.model_id.toLowerCase().includes(query)
  )
  const first = (page - 1) * PAGE_SIZE
  const visible = models.slice(first, first + PAGE_SIZE)

  return (
    <section aria-label="Model catalog" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          type="search"
          aria-label="Search models by name or ID"
          placeholder="Search by name or model ID"
          value={search}
          className="sm:max-w-xs"
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
        />
        <p className="text-sm text-muted-foreground">
          Each API key shares its RPM limit across all models.
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <Table aria-label="Models" className="min-w-[40rem]">
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead scope="col" className="pl-4">
                Model name
              </TableHead>
              <TableHead scope="col">Model ID</TableHead>
              <TableHead scope="col" className="text-right">
                Tokens / credit
              </TableHead>
              <TableHead scope="col" className="text-right">
                Est. credits / 1M tokens
              </TableHead>
              <TableHead scope="col" className="pl-4">
                Status
              </TableHead>
              <TableHead scope="col" className="pr-4 text-right">
                RPM / key
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((model) => (
              <TableRow key={model.model_id}>
                <TableCell className="max-w-52 pl-4 font-medium wrap-anywhere whitespace-normal">
                  {model.name}
                </TableCell>
                <TableCell className="max-w-72">
                  <div className="flex items-center gap-1">
                    <code className="text-xs wrap-anywhere whitespace-normal">
                      {model.model_id}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="shrink-0"
                      aria-label={`Copy model ID ${model.model_id}`}
                      onClick={() => void copyModelId(model.model_id)}
                    >
                      <Copy />
                    </Button>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatRange(
                    model.tokens_per_credit,
                    (value) => `${formatCredits(value)}x`
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatRange(
                    model.credits_per_million_tokens,
                    formatEstimatedCredits
                  )}
                </TableCell>
                <TableCell className="pl-4">
                  <Badge
                    variant={model.status === "ready" ? "secondary" : "outline"}
                  >
                    {STATUS_LABEL[model.status]}
                  </Badge>
                </TableCell>
                <TableCell className="pr-4 text-right tabular-nums">
                  {catalog.requests_per_minute_per_key}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!visible.length && (
          <Empty role="status">
            <EmptyHeader>
              <EmptyTitle>
                {query ? "No matching models" : "No models listed"}
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </div>
      {visible.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Rates can vary by route. Ready models have a configured route and
          rate.
        </p>
      )}
      {models.length > PAGE_SIZE && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p
            role="status"
            className="text-sm text-muted-foreground tabular-nums"
          >
            {first + 1}–{first + visible.length} of {models.length}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={first + visible.length >= models.length}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
