"use client"

import * as React from "react"
import {
  Activity,
  Boxes,
  Gauge,
  KeyRound,
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
} from "@/components/ui/sidebar"

const navigation = [
  { title: "Dashboard", url: "/dashboard", icon: Gauge },
  { title: "Playground", url: "/dashboard/playground", icon: Sparkles },
  { title: "API Keys", url: "/dashboard/api-keys", icon: KeyRound },
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
    title: "LLM Traces",
    url: "/dashboard/traces",
    icon: Activity,
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
  const navMain = navigation
    .filter((item) => !item.superuserOnly || role === "superuser")
    .map((item) => ({
      title: item.title,
      url: item.url,
      icon: item.icon,
      isActive:
        item.url === "/dashboard"
          ? currentPath === item.url
          : currentPath === item.url || currentPath.startsWith(`${item.url}/`),
    }))

  return (
    <Sidebar variant="inset" {...props}>
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
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={{ ...user, avatar: user.avatar ?? "" }} />
      </SidebarFooter>
    </Sidebar>
  )
}
