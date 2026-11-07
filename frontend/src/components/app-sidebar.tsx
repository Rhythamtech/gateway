"use client"

import * as React from "react"
import {
  Activity,
  Boxes,
  Coins,
  Gauge,
  KeyRound,
  ListChecks,
  PlusCircle,
  Server,
  Settings,
  Sparkles,
  UsersRound,
} from "lucide-react"

import { BrandLockup } from "@/components/brand"
import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

const navigation = [
  { title: "Dashboard", url: "/dashboard", icon: Gauge },
  { title: "Playground", url: "/dashboard/playground", icon: Sparkles },
  { title: "API Keys", url: "/dashboard/api-keys", icon: KeyRound },
  { title: "Credits", url: "/dashboard/credits", icon: Coins },
  {
    title: "Providers",
    url: "/dashboard/providers",
    icon: Server,
    superuserOnly: true,
  },
  {
    title: "Model Groups",
    url: "/dashboard/model-groups",
    icon: Boxes,
    superuserOnly: true,
  },
  {
    title: "Users",
    url: "/dashboard/users",
    icon: UsersRound,
    superuserOnly: true,
  },
  {
    title: "Request traces",
    url: "/dashboard/traces",
    icon: Activity,
  },
  {
    title: "Credit review",
    url: "/dashboard/credit-review",
    icon: ListChecks,
    superuserOnly: true,
  },
  { title: "Settings", url: "/dashboard/settings", icon: Settings },
]

export function AppSidebar({
  role = "user",
  currentPath = "/dashboard",
  user,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  role?: "user" | "superuser"
  currentPath?: string
  user: {
    name: string
    email: string
    avatar?: string
    role?: "user" | "superuser"
  }
}) {
  const { setOpenMobile } = useSidebar()
  React.useEffect(() => {
    // Closing on click can remove a mobile link before Astro routes it.
    const closeMobileNavigation = () => setOpenMobile(false)
    document.addEventListener("astro:after-swap", closeMobileNavigation)
    return () =>
      document.removeEventListener("astro:after-swap", closeMobileNavigation)
  }, [setOpenMobile])

  const navItems = navigation
    .filter((item) => !item.superuserOnly || role === "superuser")
    .map((item) => ({
      ...item,
      isActive:
        item.url === "/dashboard"
          ? currentPath === item.url
          : currentPath === item.url || currentPath.startsWith(`${item.url}/`),
    }))

  return (
    <Sidebar variant="inset" collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href="/dashboard">
                <BrandLockup markClassName="size-8" />
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu className="px-2">
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip={
                role === "superuser" ? "Review credits" : "Open Playground"
              }
              className="bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90 hover:text-sidebar-primary-foreground dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90"
            >
              <a
                href={
                  role === "superuser"
                    ? "/dashboard/credit-review"
                    : "/dashboard/playground"
                }
              >
                <PlusCircle />
                <span>
                  {role === "superuser" ? "Review credits" : "Open Playground"}
                </span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <NavMain
          items={navItems.filter(
            (item) => !item.superuserOnly && item.url !== "/dashboard/settings"
          )}
        />
        {role === "superuser" && (
          <NavMain
            label="Administration"
            items={navItems.filter((item) => item.superuserOnly)}
          />
        )}
      </SidebarContent>
      <SidebarFooter>
        <NavMain
          items={navItems.filter((item) => item.url === "/dashboard/settings")}
        />
        <NavUser user={{ ...user, avatar: user.avatar ?? "" }} />
      </SidebarFooter>
    </Sidebar>
  )
}
