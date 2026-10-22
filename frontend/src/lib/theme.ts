export type Theme = "light" | "dark" | "system"
export type ResolvedTheme = "light" | "dark"

export const THEME_STORAGE_KEY = "gateway-theme"
export const THEME_CHANGE_EVENT = "gateway-theme-change"

const THEMES: Theme[] = ["light", "dark", "system"]

function isTheme(value: string | null): value is Theme {
  return value !== null && THEMES.includes(value as Theme)
}

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") {
    return "system"
  }

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(stored) ? stored : "system"
  } catch {
    return "system"
  }
}

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") {
    return "light"
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === "system" ? getSystemTheme() : theme
}

export function applyTheme(theme: Theme, { persist = false } = {}) {
  if (typeof document === "undefined") {
    return
  }

  const resolved = resolveTheme(theme)
  const root = document.documentElement
  root.classList.toggle("dark", resolved === "dark")
  root.style.colorScheme = resolved
  root.dataset.theme = theme

  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((meta) => {
      meta.content = resolved === "dark" ? "#0a0a0a" : "#ffffff"
    })

  if (persist) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Storage can be unavailable (private mode, disabled cookies); the theme
      // still applies for the current page.
    }
  }

  window.dispatchEvent(
    new CustomEvent(THEME_CHANGE_EVENT, {
      detail: { theme, resolvedTheme: resolved },
    })
  )
}

export function setTheme(theme: Theme) {
  applyTheme(theme, { persist: true })
}
