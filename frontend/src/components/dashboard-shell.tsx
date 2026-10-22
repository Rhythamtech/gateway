import * as React from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

type DashboardShellProps = {
  children: React.ReactNode
  currentPath?: string
  pageTitle?: string
  role?: "user" | "superuser"
  user: {
    name: string
    email: string
    avatar?: string
    role?: "user" | "superuser"
  }
}

export function DashboardShell({
  children,
  currentPath = "/dashboard",
  pageTitle = "Dashboard",
  role = "user",
  user,
}: DashboardShellProps) {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar role={role} currentPath={currentPath} user={user} />
      <SidebarInset>
        <SiteHeader title={pageTitle} />
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
