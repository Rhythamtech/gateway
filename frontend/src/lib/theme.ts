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

  const fallback = /^\/dashboard(?:\/|$)/.test(window.location.pathname)
    ? "dark"
    : "system"
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(stored) ? stored : fallback
  } catch {
    return fallback
  }
}

// Browser-chrome color behind the content; light canvas is always white and
// dark canvas follows whichever theme style is active. Keep in sync with the
// bootstrap script in main.astro.
const DARK_CANVAS_META: Record<ThemeStyle, string> = {
  classic: "#0a0a0a",
  "endless-blue": "#0a0b0d",
  "fresh-green": "#001e2b",
  ember: "#000000",
}

function getMetaColor(resolved: ResolvedTheme): string {
  if (resolved === "light") return "#ffffff"
  return DARK_CANVAS_META[getStoredThemeStyle()]
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
      meta.content = getMetaColor(resolved)
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

export type ThemeStyle = "classic" | "endless-blue" | "fresh-green" | "ember"

export const THEME_STYLE_STORAGE_KEY = "gateway-theme-style"
export const THEME_STYLE_CHANGE_EVENT = "gateway-theme-style-change"

// Append new styles here and they are available everywhere (validation,
// defaulting, and the settings select) — no other list to maintain. Each
// style needs matching token overrides in global.css plus a select item
// and a value in the main.astro bootstrap allowlist.
const THEME_STYLES: ThemeStyle[] = [
  "classic",
  "endless-blue",
  "fresh-green",
  "ember",
]

function isThemeStyle(value: string | null): value is ThemeStyle {
  return value !== null && THEME_STYLES.includes(value as ThemeStyle)
}

export function getStoredThemeStyle(): ThemeStyle {
  if (typeof window === "undefined") {
    return "classic"
  }

  try {
    const stored = window.localStorage.getItem(THEME_STYLE_STORAGE_KEY)
    return isThemeStyle(stored) ? stored : "classic"
  } catch {
    return "classic"
  }
}

export function applyThemeStyle(style: ThemeStyle, { persist = false } = {}) {
  if (typeof document === "undefined") {
    return
  }

  document.documentElement.dataset.themeStyle = style

  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((meta) => {
      meta.content = getMetaColor(
        document.documentElement.classList.contains("dark") ? "dark" : "light"
      )
    })

  if (persist) {
    try {
      window.localStorage.setItem(THEME_STYLE_STORAGE_KEY, style)
    } catch {
      // Storage can be unavailable; the style still applies for this page.
    }
  }

  window.dispatchEvent(
    new CustomEvent(THEME_STYLE_CHANGE_EVENT, { detail: { style } })
  )
}

export function setThemeStyle(style: ThemeStyle) {
  applyThemeStyle(style, { persist: true })
}
