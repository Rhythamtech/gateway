import * as React from "react"
import {
  IconBan,
  IconCircleCheckFilled,
  IconRefresh,
} from "@tabler/icons-react"

import {
  getMyWallet,
  listMyWalletTransactions,
  type WalletBalance,
  type WalletEntryType,
  type WalletTransaction,
  type WalletTransactionPage,
} from "@/lib/auth"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const PAGE_SIZE = 20

const ENTRY_LABELS: Record<WalletEntryType, string> = {
  top_up: "Top-up",
  reserve: "Reserve",
  settle: "Settle",
  release: "Release",
}

function formatCredits(value: number) {
  return value.toLocaleString("en-US")
}

// Signed per-row deltas exactly as the ledger returns them.
function formatDelta(value: number) {
  if (value === 0) return "0"
  return value > 0
    ? `+${formatCredits(value)}`
    : `-${formatCredits(Math.abs(value))}`
}

function deltaClass(value: number) {
  if (value > 0) return "text-green-600 dark:text-green-400"
  if (value < 0) return "text-red-600 dark:text-red-400"
  return "text-muted-foreground"
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function StatusBadge({ status }: { status: WalletBalance["status"] }) {
  if (status === "active") {
    return (
      <Badge variant="outline" className="px-1.5 text-muted-foreground">
        <IconCircleCheckFilled className="fill-green-500 dark:fill-green-400" />
        Active
      </Badge>
    )
  }
  if (status === "debt") {
    return (
      <Badge
        variant="outline"
        className="px-1.5 text-amber-700 dark:text-amber-400"
      >
        Debt
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="px-1.5 text-destructive">
      <IconBan />
      Blocked
    </Badge>
  )
}

function DeltaCell({ value }: { value: number }) {
  return (
    <span className={`font-mono text-xs tabular-nums ${deltaClass(value)}`}>
      {formatDelta(value)}
    </span>
  )
}

export function WalletContent() {
  const [wallet, setWallet] = React.useState<WalletBalance | null>(null)
  const [walletError, setWalletError] = React.useState<string | null>(null)
  // The transaction pages load only after the wallet exists, because
  // GET /wallet provisions it lazily on first read.
  const [transactions, setTransactions] =
    React.useState<WalletTransactionPage | null>(null)
  const [transactionsError, setTransactionsError] = React.useState<
    string | null
  >(null)
  const [page, setPage] = React.useState(1)
  const [reloadTick, setReloadTick] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false

    getMyWallet()
      .then((result) => {
        if (cancelled) return
        setWallet(result)
        setWalletError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setWalletError(
          error instanceof Error ? error.message : "Unable to load your wallet."
        )
      })

    return () => {
      cancelled = true
    }
  }, [reloadTick])

  React.useEffect(() => {
    if (wallet === null) return
    let cancelled = false

    listMyWalletTransactions({ page, pageSize: PAGE_SIZE })
      .then((result) => {
        if (cancelled) return
        setTransactions(result)
        setTransactionsError(null)
        // The ledger can shrink between fetches; the toolbar buttons are
        // derived from the last page seen, so clamp the page number here.
        const totalPages = Math.max(
          1,
          Math.ceil(result.total / result.page_size)
        )
        if (page > totalPages) setPage(totalPages)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setTransactionsError(
          error instanceof Error
            ? error.message
            : "Unable to load wallet transactions."
        )
      })

    return () => {
      cancelled = true
    }
    // wallet !== null gates this fetch on the lazily provisioned wallet.
  }, [wallet, page, reloadTick])

  function refreshAll() {
    setPage(1)
    setReloadTick((tick) => tick + 1)
  }

  const walletLoadFailed = walletError !== null && wallet === null
  const loadingWallet = wallet === null && walletError === null

  return (
    <>
      <div className="flex flex-col items-start justify-between gap-2 px-4 lg:flex-row lg:items-center lg:px-6">
        <p className="text-sm text-muted-foreground">
          Your credit balance and the append-only ledger of every change.
          Credits fund inference requests and are not currency.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={refreshAll}
          disabled={loadingWallet}
        >
          <IconRefresh />
          <span className="hidden lg:inline">Refresh</span>
        </Button>
      </div>

      {walletLoadFailed ? (
        <div className="px-4 lg:px-6">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Unable to load your wallet</CardTitle>
              <CardDescription>{walletError}</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button onClick={refreshAll}>Try again</Button>
            </CardFooter>
          </Card>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
            <Card className="@container/card">
              <CardHeader>
                <CardDescription>Available credits</CardDescription>
                {wallet ? (
                  <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                    {formatCredits(wallet.available_credits)}
                  </CardTitle>
                ) : (
                  <CardTitle className="text-2xl font-semibold text-muted-foreground tabular-nums @[250px]/card:text-3xl">
                    —
                  </CardTitle>
                )}
                <CardAction>
                  {wallet ? <StatusBadge status={wallet.status} /> : null}
                </CardAction>
              </CardHeader>
              <CardFooter className="flex-col items-start gap-1.5 text-sm">
                <div className="text-muted-foreground">
                  Spendable balance for inference requests.
                </div>
                {wallet ? (
                  <div className="text-muted-foreground">
                    Updated {formatDateTime(wallet.updated_at)}
                  </div>
                ) : null}
              </CardFooter>
            </Card>

            <Card className="@container/card">
              <CardHeader>
                <CardDescription>Reserved credits</CardDescription>
                <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                  {wallet ? formatCredits(wallet.reserved_credits) : "—"}
                </CardTitle>
              </CardHeader>
              <CardFooter className="flex-col items-start gap-1.5 text-sm">
                <div className="text-muted-foreground">
                  Held while requests settle; released after a call completes.
                </div>
              </CardFooter>
            </Card>

            <Card className="@container/card">
              <CardHeader>
                <CardDescription>Debt credits</CardDescription>
                <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                  {wallet ? formatCredits(wallet.debt_credits) : "—"}
                </CardTitle>
              </CardHeader>
              <CardFooter className="flex-col items-start gap-1.5 text-sm">
                <div className="text-muted-foreground">
                  Recorded when usage exceeded the available balance.
                </div>
              </CardFooter>
            </Card>

            <Card className="@container/card">
              <CardHeader>
                <CardDescription>Lifetime credited</CardDescription>
                <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                  {wallet
                    ? formatCredits(wallet.lifetime_credited_credits)
                    : "—"}
                </CardTitle>
              </CardHeader>
              <CardFooter className="flex-col items-start gap-1.5 text-sm">
                <div className="text-muted-foreground">
                  Lifetime spent:{" "}
                  {wallet ? formatCredits(wallet.lifetime_spent_credits) : "—"}{" "}
                  credits
                </div>
              </CardFooter>
            </Card>
          </div>

          <div className="px-4 lg:px-6">
            {transactionsError !== null && transactions !== null ? (
              <p className="mb-2 text-sm text-destructive" role="alert">
                {transactionsError}{" "}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={refreshAll}
                >
                  Try again
                </button>
              </p>
            ) : null}
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted">
                  <TableRow>
                    <TableHead>Created</TableHead>
                    <TableHead>Entry</TableHead>
                    <TableHead className="text-right">Δ Available</TableHead>
                    <TableHead className="text-right">Δ Reserved</TableHead>
                    <TableHead className="text-right">Δ Debt</TableHead>
                    <TableHead className="text-right">Charged</TableHead>
                    <TableHead className="text-right">Balance after</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wallet === null ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="h-24 text-center text-muted-foreground"
                      >
                        Loading wallet…
                      </TableCell>
                    </TableRow>
                  ) : transactionsError !== null && transactions === null ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="h-24 text-center text-destructive"
                        role="alert"
                      >
                        {transactionsError}{" "}
                        <button
                          type="button"
                          className="underline underline-offset-2"
                          onClick={refreshAll}
                        >
                          Try again
                        </button>
                      </TableCell>
                    </TableRow>
                  ) : transactions === null || transactionsError !== null ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="h-24 text-center text-muted-foreground"
                      >
                        Loading transactions…
                      </TableCell>
                    </TableRow>
                  ) : transactions.items.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No wallet transactions yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    transactions.items.map((transaction) => (
                      <WalletTransactionRow
                        key={transaction.id}
                        transaction={transaction}
                      />
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {transactions && !transactionsError && transactions.total > 0 ? (
              <PaginationBar
                page={page}
                pageSize={transactions.page_size}
                total={transactions.total}
                disabled={wallet === null}
                onPageChange={setPage}
              />
            ) : null}
          </div>
        </>
      )}
    </>
  )
}

function WalletTransactionRow({
  transaction,
}: {
  transaction: WalletTransaction
}) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground">
        {formatDateTime(transaction.created_at)}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="px-1.5 text-muted-foreground">
          {ENTRY_LABELS[transaction.entry_type]}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <DeltaCell value={transaction.available_delta_credits} />
      </TableCell>
      <TableCell className="text-right">
        <DeltaCell value={transaction.reserved_delta_credits} />
      </TableCell>
      <TableCell className="text-right">
        <DeltaCell value={transaction.debt_delta_credits} />
      </TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">
        {formatCredits(transaction.charged_credits)}
      </TableCell>
      <TableCell className="text-right">
        <span className="font-mono text-xs tabular-nums">
          {formatCredits(transaction.balance_after_credits)}
        </span>
        {transaction.reserved_after_credits !== 0 ||
        transaction.debt_after_credits !== 0 ? (
          <span className="ml-2 text-xs text-muted-foreground tabular-nums">
            res {formatCredits(transaction.reserved_after_credits)}
            {transaction.debt_after_credits !== 0
              ? ` · debt ${formatCredits(transaction.debt_after_credits)}`
              : ""}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="max-w-[24rem]">
        <span
          className="block truncate text-muted-foreground"
          title={transaction.reason}
        >
          {transaction.reason}
        </span>
        {transaction.source_call_trace_id ? (
          <span
            className="block truncate text-xs text-muted-foreground"
            title={`Source call trace: ${transaction.source_call_trace_id}`}
          >
            trace {transaction.source_call_trace_id.slice(0, 8)}…
          </span>
        ) : null}
      </TableCell>
    </TableRow>
  )
}

function PaginationBar({
  page,
  pageSize,
  total,
  disabled,
  onPageChange,
}: {
  page: number
  pageSize: number
  total: number
  disabled: boolean
  onPageChange: (page: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)

  return (
    <div className="flex flex-col items-start justify-between gap-2 pt-2 sm:flex-row sm:items-center">
      <p className="text-sm text-muted-foreground">
        Showing {formatCredits(start)}–{formatCredits(end)} of{" "}
        {formatCredits(total)} transactions.
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <span className="text-sm text-muted-foreground tabular-nums">
          Page {page} of {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
