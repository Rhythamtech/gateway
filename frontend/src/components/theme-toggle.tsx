import * as React from "react"
import { Monitor, Moon, Sun } from "lucide-react"

import { useTheme, useThemeStyle } from "@/hooks/use-theme"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { Theme, ThemeStyle } from "@/lib/theme"

const modeOptions: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
]

const styleOptions: {
  value: ThemeStyle
  label: string
  color: string
}[] = [
  { value: "classic", label: "Classic", color: "#737373" },
  { value: "endless-blue", label: "Endless Blue", color: "#0052ff" },
  { value: "fresh-green", label: "Fresh Green", color: "#00ed64" },
  { value: "ember", label: "Ember", color: "#ff4801" },
  { value: "devlog", label: "DevLog", color: "#4ade80" },
]

export function ThemeToggle({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { theme, setTheme } = useTheme()
  const { themeStyle, setThemeStyle } = useThemeStyle()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Switch theme"
          title="Switch theme"
          className={cn(className)}
          {...props}
        >
          <Sun className="size-4 dark:hidden" />
          <Moon className="hidden size-4 dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Mode
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => setTheme(value as Theme)}
        >
          {modeOptions.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <option.icon className="size-4" />
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          Theme Style
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={themeStyle}
          onValueChange={(value) => setThemeStyle(value as ThemeStyle)}
        >
          {styleOptions.map((style) => (
            <DropdownMenuRadioItem key={style.value} value={style.value}>
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: style.color }}
                aria-hidden="true"
              />
              <span className="flex-1 truncate">{style.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
