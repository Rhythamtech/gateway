import { lazy, type ComponentType } from "react"
import type { CurrentUser } from "@/lib/auth"

type PageModule = { default: ComponentType<{ user: CurrentUser }> }
function route(
  path: string,
  title: string,
  load: () => Promise<PageModule>,
  superuser = false
) {
  // Link intent and React.lazy share the same import, including in-flight work.
  let promise: Promise<PageModule> | undefined
  const preload = () => (promise ??= load())
  return { path, title, superuser, preload, Component: lazy(preload) }
}

const routes = [
  route(
    "/dashboard/providers/detail",
    "Provider details",
    () =>
      import("@/components/provider-detail").then((m) => ({
        default: m.ProviderDetailContent,
      })),
    true
  ),
  route(
    "/dashboard/providers",
    "Providers",
    () =>
      import("@/components/providers").then((m) => ({
        default: m.ProvidersContent,
      })),
    true
  ),
  route(
    "/dashboard/model-groups/detail",
    "Model group details",
    () =>
      import("@/components/model-group-detail").then((m) => ({
        default: m.ModelGroupDetailContent,
      })),
    true
  ),
  route(
    "/dashboard/model-groups",
    "Model Groups",
    () =>
      import("@/components/model-groups").then((m) => ({
        default: m.ModelGroupsContent,
      })),
    true
  ),
  route(
    "/dashboard/traces/detail",
    "Trace details",
    () =>
      import("@/components/traces").then((m) => ({
        default: m.TraceDetailContent,
      })),
    false
  ),
  route(
    "/dashboard/traces",
    "Request traces",
    () =>
      import("@/components/traces").then((m) => ({ default: m.TracesContent })),
    false
  ),
  route("/dashboard/playground", "Playground", () =>
    import("@/components/playground").then((m) => ({
      default: m.PlaygroundContent,
    }))
  ),
  route("/dashboard/api-keys", "API Keys", () =>
    import("@/components/api-keys").then((m) => ({ default: m.ApiKeysContent }))
  ),
  route("/dashboard/credits", "Credits", () =>
    import("@/components/credits").then((m) => ({ default: m.CreditsContent }))
  ),
  route(
    "/dashboard/coupons",
    "Coupons",
    () =>
      import("@/components/coupons").then((m) => ({
        default: m.CouponsContent,
      })),
    true
  ),
  route(
    "/dashboard/credit-review",
    "Credit review",
    () =>
      import("@/components/credit-review").then((m) => ({
        default: m.CreditReviewContent,
      })),
    true
  ),
  route(
    "/dashboard/users/detail",
    "User details",
    () =>
      import("@/components/user-detail").then((m) => ({
        default: m.UserDetailContent,
      })),
    true
  ),
  route(
    "/dashboard/users",
    "Users",
    () =>
      import("@/components/users").then((m) => ({ default: m.UsersContent })),
    true
  ),
  route("/dashboard/support", "Support", () =>
    import("@/components/support").then((m) => ({
      default: m.SupportDashboardContent,
    }))
  ),
  route("/dashboard/settings", "Settings", () =>
    import("@/components/settings").then((m) => ({
      default: m.SettingsContent,
    }))
  ),
  route("/dashboard", "Dashboard", () =>
    import("@/components/dashboard-overview").then((m) => ({
      default: m.DashboardOverview,
    }))
  ),
]

export function getDashboardRoute(path: string) {
  return routes.find((item) => item.path === path)
}

export function isSuperuserDashboardRoute(path: string) {
  return routes.some(
    (item) =>
      item.superuser && (path === item.path || path.startsWith(`${item.path}/`))
  )
}
