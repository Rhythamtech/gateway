import * as React from "react"
import {
  listCouponRedemptions,
  type CouponPage,
  type CouponRedemption,
} from "@/lib/auth"
import { formatCredits } from "@/lib/credits"
import { formatTimestampInDeviceZone, parseApiTimestamp } from "@/lib/datetime"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"

export function CouponHistory({
  couponId,
  revision = 0,
}: {
  couponId?: string
  revision?: number
}) {
  const [page, setPage] = React.useState(1)
  const [retry, setRetry] = React.useState(0)
  const key = `${page}:${couponId ?? "me"}:${revision}:${retry}`
  const [result, setResult] = React.useState<{
    key: string
    data?: CouponPage<CouponRedemption>
    error?: string
  } | null>(null)
  const loading = result?.key !== key
  const data = loading ? undefined : result?.data
  const error = loading ? "" : result?.error
  React.useEffect(() => {
    let active = true
    listCouponRedemptions(page, couponId)
      .then((data) => {
        if (active) setResult({ key, data })
      })
      .catch((error) => {
        if (active)
          setResult({
            key,
            error:
              error instanceof Error
                ? error.message
                : "Could not load redemptions.",
          })
      })
    return () => {
      active = false
    }
  }, [page, couponId, key])
  return (
    <Card>
      <CardHeader>
        <CardTitle>Redemption history</CardTitle>
        <CardDescription>Credits awarded through coupons.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <p role="alert">{error}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                {couponId && <TableHead>User</TableHead>}
                <TableHead>Credits</TableHead>
                <TableHead>Redeemed</TableHead>
                <TableHead>Ledger entry</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.length ? (
                data.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.code}</TableCell>
                    {couponId && (
                      <TableCell className="break-all">
                        {item.user_id}
                      </TableCell>
                    )}
                    <TableCell>{formatCredits(item.credits)}</TableCell>
                    <TableCell>
                      {formatTimestampInDeviceZone(
                        parseApiTimestamp(item.created_at) ??
                          new Date(item.created_at)
                      )}
                    </TableCell>
                    <TableCell className="break-all">
                      {item.credit_entry.id}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={couponId ? 5 : 4}>
                    No redemptions yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => setRetry((value) => value + 1)}
        >
          Refresh
        </Button>
        <Button
          variant="outline"
          disabled={loading || page === 1}
          onClick={() => setPage((value) => value - 1)}
        >
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {page}
          {data && ` · ${data.total} redemptions`}
        </span>
        <Button
          variant="outline"
          disabled={
            loading || !!error || !data || page * data.page_size >= data.total
          }
          onClick={() => setPage((value) => value + 1)}
        >
          Next
        </Button>
      </CardFooter>
    </Card>
  )
}
