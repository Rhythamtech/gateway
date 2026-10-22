import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  // Read the viewport in the state initializer so the first render is already
  // correct and no state write is needed inside the effect (which the
  // react-hooks rules flag as a cascading render). The listener keeps the
  // value in sync afterwards.
  const [isMobile, setIsMobile] = React.useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches
  )

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches)
    }
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
