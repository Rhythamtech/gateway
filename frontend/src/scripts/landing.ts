import {
  clearAuthTokens,
  getCachedUser,
  hasAuthTokens,
  validateSession,
} from "@/lib/auth"

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
  const background = [
    document.querySelector<HTMLElement>(".page"),
    document.querySelector<HTMLElement>(".of-footer"),
  ]
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
    background.forEach((element) => {
      if (element) element.inert = true
    })

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
    background.forEach((element) => {
      if (element) element.inert = false
    })

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
    if (event.key === "Tab" && isOpen()) {
      const controls = Array.from(
        overlay.querySelectorAll<HTMLElement>("a[href], button")
      )
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    if (event.key === "Escape" && isOpen()) {
      event.preventDefault()
      closeMenu()
    }
  })

  mobileLinks.forEach((link) => {
    link.addEventListener("click", () => closeMenu(false))
  })
  overlay
    .querySelector(".mobile-close")
    ?.addEventListener("click", () => closeMenu())

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

  const toggle = document.querySelector<HTMLButtonElement>(".motion-toggle")
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
  const update = () => {
    if (!toggle) return
    toggle.textContent = video.paused ? "Play background" : "Pause background"
    toggle.setAttribute("aria-pressed", String(!video.paused))
  }
  const play = () => {
    void video.play().catch(update)
  }
  video.addEventListener("play", update)
  video.addEventListener("pause", update)
  toggle?.addEventListener("click", () => {
    if (video.paused) play()
    else video.pause()
  })
  reduced.addEventListener("change", (event) => {
    if (event.matches) video.pause()
  })
  if (reduced.matches) video.pause()
  else play()
  update()
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

const setUpAuthState = (): void => {
  const headerSignin = document.querySelector<HTMLAnchorElement>(".signin")
  const heroCta = document.querySelector<HTMLAnchorElement>(".cta")
  const mobileSignin =
    document.querySelector<HTMLAnchorElement>(".mobile-signin")
  const heroUserStatus =
    document.querySelector<HTMLElement>(".hero-user-status")
  const heroUserEmail = document.querySelector<HTMLElement>(".hero-user-email")
  const heroSignoutBtn =
    document.querySelector<HTMLButtonElement>(".hero-signout-btn")
  const mobileSignoutBtn =
    document.querySelector<HTMLButtonElement>(".mobile-signout")
  const footerSignin = document.querySelector<HTMLAnchorElement>(
    "[data-footer-signin]"
  )
  const footerSignup = document.querySelector<HTMLAnchorElement>(
    "[data-footer-signup]"
  )

  const applyGuestState = (): void => {
    if (headerSignin) {
      headerSignin.textContent = "Sign in"
      headerSignin.href = "/login"
      headerSignin.classList.remove("is-authenticated")
      headerSignin.removeAttribute("aria-label")
    }
    if (heroCta) {
      heroCta.textContent = "Get Started"
      heroCta.href = "/signup"
      heroCta.removeAttribute("aria-label")
    }
    if (mobileSignin) {
      mobileSignin.textContent = "Sign in"
      mobileSignin.href = "/login"
    }
    if (heroUserStatus) {
      heroUserStatus.hidden = true
    }
    if (heroUserEmail) {
      heroUserEmail.textContent = ""
    }
    if (mobileSignoutBtn) {
      mobileSignoutBtn.hidden = true
    }
    if (footerSignin) {
      footerSignin.textContent = "Sign in"
      footerSignin.href = "/login"
    }
    if (footerSignup) {
      footerSignup.textContent = "Get Started"
      footerSignup.href = "/signup"
    }
  }

  const applyAuthState = (email?: string): void => {
    if (headerSignin) {
      headerSignin.textContent = "Open Dashboard"
      headerSignin.href = "/dashboard"
      headerSignin.classList.add("is-authenticated")
      headerSignin.setAttribute("aria-label", "Open Dashboard")
    }
    if (heroCta) {
      heroCta.textContent = "Open Dashboard"
      heroCta.href = "/dashboard"
      heroCta.setAttribute("aria-label", "Open Dashboard")
    }
    if (mobileSignin) {
      mobileSignin.textContent = "Open Dashboard"
      mobileSignin.href = "/dashboard"
    }
    if (heroUserStatus) {
      heroUserStatus.hidden = false
      if (heroUserEmail && email) {
        heroUserEmail.textContent = email
      }
    }
    if (mobileSignoutBtn) {
      mobileSignoutBtn.hidden = false
    }
    if (footerSignin) {
      footerSignin.textContent = "Dashboard"
      footerSignin.href = "/dashboard"
    }
    if (footerSignup) {
      footerSignup.textContent = "Playground"
      footerSignup.href = "/dashboard/playground"
    }
  }

  const handleSignOut = (): void => {
    clearAuthTokens()
    applyGuestState()
  }

  heroSignoutBtn?.addEventListener("click", handleSignOut)
  mobileSignoutBtn?.addEventListener("click", handleSignOut)

  // Synchronous pass: Paint active session immediately if tokens are stored
  if (hasAuthTokens()) {
    const cached = getCachedUser()
    applyAuthState(cached?.email || "")

    // Asynchronous revalidation
    void validateSession().then((user) => {
      if (user) {
        applyAuthState(user.email)
      } else {
        applyGuestState()
      }
    })
  } else {
    applyGuestState()
  }
}

export const initLanding = (): void => {
  setUpAuthState()
  setUpMenu()
  startVideo()
  setUpCounters()
}
