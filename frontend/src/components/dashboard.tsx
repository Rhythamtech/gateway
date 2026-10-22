import { ChartAreaInteractive } from "@/components/chart-area-interactive"
import { DataTable } from "@/components/data-table"
import { AuthGate } from "@/components/auth-gate"
import { DashboardShell } from "@/components/dashboard-shell"
import { SectionCards } from "@/components/section-cards"
import data from "@/app/dashboard/data.json"

export function Dashboard({
  currentPath = "/dashboard",
}: {
  currentPath?: string
}) {
  const pageTitle =
    currentPath === "/dashboard"
      ? "Dashboard"
      : currentPath.startsWith("/dashboard/api-keys")
        ? "API Keys"
        : currentPath.startsWith("/dashboard/providers")
          ? "Providers"
          : currentPath.startsWith("/dashboard/model-groups")
            ? "Model Groups"
            : currentPath.startsWith("/dashboard/users")
              ? "Users"
              : "Dashboard"

  const requiresSuperuser = [
    "/dashboard/providers",
    "/dashboard/model-groups",
    "/dashboard/users",
  ].some((path) => currentPath === path || currentPath.startsWith(`${path}/`))

  return (
    <AuthGate requiresSuperuser={requiresSuperuser}>
      {(user) => (
        <DashboardShell
          currentPath={currentPath}
          pageTitle={pageTitle}
          role={user.role}
          user={{ name: user.email, email: user.email, role: user.role }}
        >
          <div className="flex flex-1 flex-col">
            <div className="@container/main flex flex-1 flex-col gap-2">
              <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
                <SectionCards />
                <div className="px-4 lg:px-6">
                  <ChartAreaInteractive />
                </div>
                <DataTable data={data} />
              </div>
            </div>
          </div>
        </DashboardShell>
      )}
    </AuthGate>
  )
}
