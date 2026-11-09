const parseNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseFloat(value ?? "")
  return Number.isFinite(parsed) ? parsed : fallback
}

const setUpMenu = (): void => {
  const burger = document.querySelector<HTMLButtonElement>(".burger")
  const overlay = document.querySelector<HTMLElement>("#mobile-menu")

  if (!burger || !overlay) {
    return
  }

  const mobileLinks = overlay.querySelectorAll<HTMLAnchorElement>("a")
  let lastFocused: Element | null = null

  const isOpen = (): boolean => !overlay.hidden

  const openMenu = (): void => {
    lastFocused = document.activeElement
    overlay.hidden = false
    burger.classList.add("is-open")
    burger.setAttribute("aria-expanded", "true")
    burger.setAttribute("aria-label", "Close menu")
    document.documentElement.classList.add("menu-open")
    document.body.classList.add("menu-open")

    const firstLink = overlay.querySelector<HTMLAnchorElement>("a")
    firstLink?.focus({ preventScroll: true })
  }

  const closeMenu = (restoreFocus = true): void => {
    if (!isOpen()) {
      return
    }

    overlay.hidden = true
    burger.classList.remove("is-open")
    burger.setAttribute("aria-expanded", "false")
    burger.setAttribute("aria-label", "Open menu")
    document.documentElement.classList.remove("menu-open")
    document.body.classList.remove("menu-open")

    if (restoreFocus && lastFocused instanceof HTMLElement) {
      lastFocused.focus({ preventScroll: true })
    }
  }

  burger.addEventListener("click", () => {
    if (isOpen()) {
      closeMenu()
    } else {
      openMenu()
    }
  })

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeMenu()
    }
  })

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      event.preventDefault()
      closeMenu()
    }
  })

  mobileLinks.forEach((link) => {
    link.addEventListener("click", () => closeMenu(false))
  })

  const mobileQuery = window.matchMedia("(max-width: 720px)")
  const handleViewportChange = (event: MediaQueryListEvent): void => {
    if (!event.matches) {
      closeMenu(false)
    }
  }

  mobileQuery.addEventListener("change", handleViewportChange)
}

const startVideo = (): void => {
  const video = document.querySelector<HTMLVideoElement>(".bg-video")
  if (!video) {
    return
  }

  const playback = video.play()
  if (playback && typeof playback.catch === "function") {
    playback.catch(() => {})
  }
}

const setUpCounters = (): void => {
  const stats = document.querySelector<HTMLElement>(".stats")
  const numbers = Array.from(
    document.querySelectorAll<HTMLElement>(".stat-number")
  )

  if (!stats || numbers.length === 0) {
    return
  }

  const showFinalValues = (): void => {
    numbers.forEach((number) => {
      const target = parseNumber(number.dataset.target, 0)
      const decimals = Number.parseInt(number.dataset.decimals ?? "0", 10)
      number.textContent = target.toFixed(decimals)
    })
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    showFinalValues()
    return
  }

  let started = false

  const runCounters = (): void => {
    if (started) {
      return
    }
    started = true

    numbers.forEach((number, index) => {
      const target = parseNumber(number.dataset.target, 0)
      const decimals = Number.parseInt(number.dataset.decimals ?? "0", 10)
      const duration = 1500 + index * 80
      const delay = 480 + index * 90

      window.setTimeout(() => {
        const startTime = performance.now()

        const tick = (now: number): void => {
          const progress = Math.min((now - startTime) / duration, 1)
          const eased = 1 - Math.pow(1 - progress, 3)
          number.textContent = (target * eased).toFixed(decimals)

          if (progress < 1) {
            window.requestAnimationFrame(tick)
          } else {
            number.textContent = target.toFixed(decimals)
          }
        }

        window.requestAnimationFrame(tick)
      }, delay)
    })
  }

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          runCounters()
          observer.disconnect()
        }
      },
      { threshold: 0.25 }
    )

    observer.observe(stats)
  } else {
    runCounters()
  }
}

export const initLanding = (): void => {
  setUpMenu()
  startVideo()
  setUpCounters()
}
