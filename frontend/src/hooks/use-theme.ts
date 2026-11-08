import * as React from "react"

import {
  getStoredTheme,
  getStoredThemeStyle,
  resolveTheme,
  setTheme,
  setThemeStyle,
  THEME_CHANGE_EVENT,
  THEME_STYLE_CHANGE_EVENT,
  type ResolvedTheme,
  type Theme,
  type ThemeStyle,
} from "@/lib/theme"

function subscribe(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)")
  media.addEventListener("change", onChange)
  window.addEventListener(THEME_CHANGE_EVENT, onChange)
  window.addEventListener(THEME_STYLE_CHANGE_EVENT, onChange)
  window.addEventListener("storage", onChange)

  return () => {
    media.removeEventListener("change", onChange)
    window.removeEventListener(THEME_CHANGE_EVENT, onChange)
    window.removeEventListener(THEME_STYLE_CHANGE_EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

function getThemeSnapshot(): Theme {
  return getStoredTheme()
}

function getResolvedThemeSnapshot(): ResolvedTheme {
  return resolveTheme(getStoredTheme())
}

function getServerThemeSnapshot(): Theme {
  return "system"
}

function getServerResolvedThemeSnapshot(): ResolvedTheme {
  return "light"
}

function getThemeStyleSnapshot(): ThemeStyle {
  return getStoredThemeStyle()
}

function getServerThemeStyleSnapshot(): ThemeStyle {
  return "classic"
}

export function useTheme() {
  const theme = React.useSyncExternalStore(
    subscribe,
    getThemeSnapshot,
    getServerThemeSnapshot
  )
  const resolvedTheme = React.useSyncExternalStore(
    subscribe,
    getResolvedThemeSnapshot,
    getServerResolvedThemeSnapshot
  )

  return { theme, resolvedTheme, setTheme }
}

export function useThemeStyle() {
  const themeStyle = React.useSyncExternalStore(
    subscribe,
    getThemeStyleSnapshot,
    getServerThemeStyleSnapshot
  )

  return { themeStyle, setThemeStyle }
}
