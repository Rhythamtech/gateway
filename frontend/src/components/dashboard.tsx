import { ApiKeysContent } from "@/components/api-keys"
import { ChartAreaInteractive } from "@/components/chart-area-interactive"
import { DataTable } from "@/components/data-table"
import { PlaygroundContent } from "@/components/playground"
import { ProviderDetailContent } from "@/components/provider-detail"
import { ProvidersContent } from "@/components/providers"
import { ModelGroupDetailContent } from "@/components/model-group-detail"
import { ModelGroupsContent } from "@/components/model-groups"
import { UsersContent } from "@/components/users"
import { TracesContent, TraceDetailContent } from "@/components/traces"
import { SettingsContent } from "@/components/settings"
import { AuthGate } from "@/components/auth-gate"
import { DashboardShell } from "@/components/dashboard-shell"
import { SectionCards } from "@/components/section-cards"
import data from "@/app/dashboard/data.json"

function DashboardOverview() {
  return (
    <>
      <SectionCards />
      <div className="px-4 lg:px-6">
        <ChartAreaInteractive />
      </div>
      <DataTable data={data} />
    </>
  )
}

export function Dashboard({
  currentPath = "/dashboard",
}: {
  currentPath?: string
}) {
  const pageTitle =
    currentPath === "/dashboard"
      ? "Dashboard"
      : currentPath.startsWith("/dashboard/playground")
        ? "Playground"
        : currentPath.startsWith("/dashboard/providers/")
          ? "Provider details"
          : currentPath === "/dashboard/providers"
            ? "Providers"
            : currentPath.startsWith("/dashboard/model-groups/")
              ? "Model group details"
              : currentPath === "/dashboard/model-groups"
                ? "Model Groups"
                : currentPath.startsWith("/dashboard/api-keys")
                  ? "API Keys"
                  : currentPath.startsWith("/dashboard/traces/detail")
                    ? "Trace details"
                    : currentPath.startsWith("/dashboard/traces")
                      ? "LLM Traces"
                      : currentPath.startsWith("/dashboard/users")
                        ? "Users"
                        : currentPath.startsWith("/dashboard/settings")
                          ? "Settings"
                          : "Dashboard"

  const requiresSuperuser = [
    "/dashboard/providers",
    "/dashboard/model-groups",
    "/dashboard/users",
    "/dashboard/traces",
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
                {currentPath.startsWith("/dashboard/playground") ? (
                  <PlaygroundContent user={user} />
                ) : currentPath === "/dashboard/providers" ? (
                  <ProvidersContent />
                ) : currentPath.startsWith("/dashboard/providers/") ? (
                  <ProviderDetailContent />
                ) : currentPath.startsWith("/dashboard/api-keys") ? (
                  <ApiKeysContent user={user} />
                ) : currentPath === "/dashboard/model-groups" ? (
                  <ModelGroupsContent />
                ) : currentPath.startsWith("/dashboard/model-groups/") ? (
                  <ModelGroupDetailContent />
                ) : currentPath === "/dashboard/users" ? (
                  <UsersContent user={user} />
                ) : currentPath.startsWith("/dashboard/traces/detail") ? (
                  <TraceDetailContent />
                ) : currentPath.startsWith("/dashboard/traces") ? (
                  <TracesContent />
                ) : currentPath.startsWith("/dashboard/settings") ? (
                  <SettingsContent user={user} />
                ) : (
                  <DashboardOverview />
                )}
              </div>
            </div>
          </div>
        </DashboardShell>
      )}
    </AuthGate>
  )
}
