import { AccountCreditAlert } from "@/components/account-credit-alert"
import { AnnouncementBanner } from "@/components/announcement-banner"
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
  const [unreadSupportCount, setUnreadSupportCount] = React.useState(0)

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 68)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <a
        href="#dashboard-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-foreground focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>
      <AppSidebar
        role={role}
        currentPath={currentPath}
        user={user}
        unreadSupportCount={unreadSupportCount}
      />
      <SidebarInset className="min-w-0 md:rounded-2xl">
        <SiteHeader
          title={pageTitle}
          onSupportUnreadChange={setUnreadSupportCount}
        />
        <AnnouncementBanner />
        <AccountCreditAlert />
        <div
          id="dashboard-content"
          tabIndex={-1}
          className="flex min-w-0 flex-1 flex-col"
        >
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

/** The one page-level content wrapper: owns outer gutters, page padding, and the 1440px content cap. Child sections never add their own page padding. */
export function PageContent({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1440px] min-w-0 px-4 pt-5 pb-6 md:px-6 md:pt-6 md:pb-8 lg:px-8 lg:pt-8 lg:pb-10">
      {children}
    </div>
  )
}
