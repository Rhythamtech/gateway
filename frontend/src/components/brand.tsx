import * as React from "react"

import { APP_NAME, APP_TAGLINE } from "@/lib/site"
import { cn } from "@/lib/utils"

export function BrandMark({
  className,
  alt = APP_NAME,
  ...props
}: Omit<React.ComponentProps<"img">, "src">) {
  return (
    <img
      src="/brand/logo.png"
      alt={alt}
      className={cn("size-8 object-contain dark:invert", className)}
      {...props}
    />
  )
}

export function BrandLockup({
  className,
  markClassName,
  ...props
}: React.ComponentProps<"div"> & { markClassName?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)} {...props}>
      <BrandMark alt="" className={markClassName} />
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{APP_NAME}</span>
        <span className="truncate text-xs">{APP_TAGLINE}</span>
      </div>
    </div>
  )
}
