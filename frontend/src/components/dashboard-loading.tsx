import { Skeleton } from "@/components/ui/skeleton"

export function DashboardPageLoading({
  label = "Loading page…",
}: {
  label?: string
}) {
  return (
    <div
      className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-6 md:px-6 lg:px-8"
      role="status"
      aria-label={label}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-2/3 max-w-lg" />
      <div className="flex flex-col gap-4 rounded-xl border p-5">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-3/4" />
      </div>
    </div>
  )
}

// Static, non-personalized HTML remains visible before the React island loads.
export function DashboardLoading({
  label = "Loading dashboard…",
}: {
  label?: string
}) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside
        aria-hidden="true"
        className="hidden w-72 shrink-0 flex-col gap-6 border-r bg-sidebar p-6 md:flex"
      >
        <Skeleton className="h-9 w-36" />
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-8 w-full" />
        ))}
      </aside>
      <main className="min-w-0 flex-1">
        <div className="flex h-12 items-center border-b px-6">
          <h1 className="text-sm font-medium">Gateway</h1>
        </div>
        <DashboardPageLoading label={label} />
      </main>
    </div>
  )
}
