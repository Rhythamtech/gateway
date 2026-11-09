const CLIP = {
  width: 1920,
  height: 1080,
  screen: { x: 806, y: 505, width: 271, height: 219 },
  origin: { x: 945, y: 594 },
  switchOnAt: 0.6,
  idleAt: 2.3,
  dotAt: 4.72,
  dotFlight: 780,
} as const

type SceneState =
  | "waiting"
  | "arriving"
  | "idle"
  | "switching-off"
  | "switching-on"
  | "offline"
  | "reduced"

type VideoMap = {
  left: number
  top: number
  scale: number
}

type Glint = {
  x: number
  y: number
  mobileX: number
  mobileY: number
  size: number
  phase: number
  speed: number
}

const createRandom = (): (() => number) => {
  let seed = 0x9e3779b9

  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
}

const random = createRandom()
const glints: Glint[] = Array.from({ length: 22 }, () => {
  const size = 0.7 + random() * 1.7

  return {
    x: 0.04 + random() * 0.92,
    y: 0.025 + random() * 0.35,
    mobileX: 0.04 + random() * 0.92,
    mobileY: 0.03 + random() * 0.42,
    size,
    phase: random() * Math.PI * 2,
    speed: 0.55 + random() * 1.5,
  }
})

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

const cubicInOut = (t: number): number => {
  if (t < 0.5) {
    return 4 * t * t * t
  }

  return 1 - Math.pow(-2 * t + 2, 3) / 2
}

const quadratic = (start: number, control: number, end: number, t: number) => {
  const inverse = 1 - t
  return inverse * inverse * start + 2 * inverse * t * control + t * t * end
}

const dotScale = (t: number): number => {
  if (t < 0.32) {
    return 0.35 + (t / 0.32) * 0.85
  }

  return 1.2 - ((t - 0.32) / 0.68) * 1.05
}

export const initOfflineFooter = (root: HTMLElement): void => {
  const video = root.querySelector<HTMLVideoElement>(".of-video")
  const overlay = root.querySelector<HTMLCanvasElement>(".of-overlay")
  const sky = root.querySelector<HTMLCanvasElement>(".of-sky")
  const power = root.querySelector<HTMLButtonElement>(".of-power")
  const powerO = root.querySelector<SVGSVGElement>(".of-power-o")
  const dot = root.querySelector<HTMLElement>(".of-dot")

  if (!video || !overlay || !sky || !power || !powerO || !dot) {
    return
  }

  const overlayContext = overlay.getContext("2d")
  const skyContext = sky.getContext("2d")
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
  const mobileQuery = window.matchMedia("(max-width: 760px)")

  let state: SceneState = "waiting"
  let revealed = false
  let inView = false
  let rafId = 0
  let playRequest = 0
  let dotRaf = 0
  let dotActive = false
  let dotLaunched = false
  let glowRaf = 0
  let width = 0
  let height = 0

  const setState = (next: SceneState): void => {
    state = next
    root.dataset.state = next
  }

  const setPressed = (offline: boolean): void => {
    const label = offline ? "Bring the scene online" : "Take the scene offline"
    power.setAttribute("aria-pressed", String(offline))
    power.setAttribute("aria-label", label)
    power.title = label
  }

  const setLit = (value: number): void => {
    power.style.setProperty("--lit", value.toFixed(3))
  }

  setPressed(false)
  setState("waiting")

  const waitForMetadata = (): Promise<void> => {
    if (video.readyState >= 1) {
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      const onLoaded = (): void => {
        video.removeEventListener("loadedmetadata", onLoaded)
        resolve()
      }

      video.addEventListener("loadedmetadata", onLoaded)
    })
  }

  const playFrom = async (time: number): Promise<boolean> => {
    const request = ++playRequest

    try {
      await waitForMetadata()

      if (request !== playRequest) {
        return false
      }

      video.currentTime = time
      await video.play()
      return true
    } catch {
      return false
    }
  }

  const getVideoMap = (): VideoMap | null => {
    const footerRect = root.getBoundingClientRect()
    const videoRect = video.getBoundingClientRect()

    if (videoRect.width === 0 || videoRect.height === 0) {
      return null
    }

    const scale = Math.max(
      videoRect.width / CLIP.width,
      videoRect.height / CLIP.height
    )

    return {
      left:
        videoRect.left -
        footerRect.left +
        (videoRect.width - CLIP.width * scale) / 2,
      top:
        videoRect.top -
        footerRect.top +
        (videoRect.height - CLIP.height * scale),
      scale,
    }
  }

  const mapClipPoint = (x: number, y: number) => {
    const map = getVideoMap()
    if (!map) {
      return null
    }

    return {
      x: map.left + x * map.scale,
      y: map.top + y * map.scale,
    }
  }

  const resize = (): void => {
    const rect = root.getBoundingClientRect()
    width = rect.width
    height = rect.height

    if (!overlayContext || width === 0 || height === 0) {
      return
    }

    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    overlay.width = Math.round(width * ratio)
    overlay.height = Math.round(height * ratio)
    overlayContext.setTransform(ratio, 0, 0, ratio, 0, 0)
  }

  const drawGlints = (now: number): void => {
    if (!overlayContext) {
      return
    }

    const time = Number.isFinite(video.currentTime) ? video.currentTime : 0
    const night = smoothstep(2.7, 4.4, time)
    const count = Math.round(10 + night * 12)
    const baseAlpha = 0.24 + night * 0.62
    const map = getVideoMap()
    const isMobile = mobileQuery.matches

    if (!isMobile && !map) {
      return
    }

    for (let index = 0; index < count; index += 1) {
      const glint = glints[index]
      if (!glint) {
        continue
      }

      const x = isMobile
        ? glint.mobileX * width
        : (map?.left ?? 0) + glint.x * CLIP.width * (map?.scale ?? 0)
      const y = isMobile
        ? glint.mobileY * height
        : (map?.top ?? 0) + glint.y * CLIP.height * (map?.scale ?? 0)

      if (x < -10 || x > width + 10 || y < -10 || y > height + 10) {
        continue
      }

      const twinkle =
        0.36 +
        0.64 * ((Math.sin((now / 1000) * glint.speed + glint.phase) + 1) / 2)
      const alpha = baseAlpha * twinkle
      const radius = glint.size * (0.82 + twinkle * 0.38)

      overlayContext.save()
      overlayContext.translate(x, y)
      overlayContext.globalAlpha = alpha
      overlayContext.globalCompositeOperation = "lighter"

      const glow = overlayContext.createRadialGradient(
        0,
        0,
        0,
        0,
        0,
        radius * 5
      )
      glow.addColorStop(0, "rgba(255, 255, 255, 0.55)")
      glow.addColorStop(1, "rgba(255, 255, 255, 0)")
      overlayContext.fillStyle = glow
      overlayContext.beginPath()
      overlayContext.arc(0, 0, radius * 5, 0, Math.PI * 2)
      overlayContext.fill()

      overlayContext.fillStyle = "#ffffff"
      overlayContext.beginPath()
      overlayContext.moveTo(0, -radius)
      overlayContext.quadraticCurveTo(radius * 0.13, -radius * 0.13, radius, 0)
      overlayContext.quadraticCurveTo(radius * 0.13, radius * 0.13, 0, radius)
      overlayContext.quadraticCurveTo(-radius * 0.13, radius * 0.13, -radius, 0)
      overlayContext.quadraticCurveTo(
        -radius * 0.13,
        -radius * 0.13,
        0,
        -radius
      )
      overlayContext.closePath()
      overlayContext.fill()
      overlayContext.restore()
    }
  }

  const drawScanline = (now: number): void => {
    if (!overlayContext || state !== "idle") {
      return
    }

    const map = getVideoMap()
    if (!map) {
      return
    }

    const x = map.left + CLIP.screen.x * map.scale
    const y = map.top + CLIP.screen.y * map.scale
    const screenWidth = CLIP.screen.width * map.scale
    const screenHeight = CLIP.screen.height * map.scale
    const bandHeight = Math.min(52, screenHeight * 0.6)
    const phase = (now % 1800) / 1800
    const bandY = y - bandHeight + phase * (screenHeight + bandHeight)
    const flicker =
      0.1 + Math.sin(now * 0.014) * 0.012 + Math.sin(now * 0.037) * 0.008
    const gradient = overlayContext.createLinearGradient(
      0,
      bandY,
      0,
      bandY + bandHeight
    )

    gradient.addColorStop(0, "rgba(255, 255, 255, 0)")
    gradient.addColorStop(0.5, `rgba(255, 255, 255, ${flicker.toFixed(3)})`)
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)")

    overlayContext.save()
    overlayContext.beginPath()
    overlayContext.rect(x, y, screenWidth, screenHeight)
    overlayContext.clip()
    overlayContext.globalCompositeOperation = "lighter"
    overlayContext.fillStyle = gradient
    overlayContext.fillRect(x, bandY, screenWidth, bandHeight)
    overlayContext.restore()
  }

  const drawSky = (): void => {
    if (!skyContext || !mobileQuery.matches || video.readyState < 2) {
      return
    }

    const videoWidth = video.videoWidth
    const videoHeight = video.videoHeight

    if (videoWidth === 0 || videoHeight === 0) {
      return
    }

    skyContext.drawImage(
      video,
      0,
      0,
      videoWidth,
      videoHeight * 0.45,
      0,
      0,
      sky.width,
      sky.height
    )
  }

  const draw = (now: number): void => {
    if (!overlayContext) {
      return
    }

    overlayContext.clearRect(0, 0, width, height)
    drawGlints(now)
    drawScanline(now)
    drawSky()
  }

  const updateVideo = (): void => {
    if (state === "arriving" || state === "switching-on") {
      if (video.readyState >= 1 && video.currentTime >= CLIP.idleAt) {
        video.pause()
        video.currentTime = CLIP.idleAt
        setState("idle")
      }
    }

    if (
      state === "switching-off" &&
      !dotLaunched &&
      video.currentTime >= CLIP.dotAt
    ) {
      dotLaunched = true
      launchDot()
    }
  }

  const frame = (now: number): void => {
    rafId = window.requestAnimationFrame(frame)
    updateVideo()

    if (inView) {
      draw(now)
    }

    if (!inView && video.paused && !dotActive) {
      stopLoop()
    }
  }

  const ensureLoop = (): void => {
    if (rafId !== 0) {
      return
    }

    rafId = window.requestAnimationFrame(frame)
  }

  function stopLoop(): void {
    if (rafId !== 0) {
      window.cancelAnimationFrame(rafId)
      rafId = 0
    }
  }

  const resetDot = (): void => {
    if (dotRaf !== 0) {
      window.cancelAnimationFrame(dotRaf)
      dotRaf = 0
    }

    dotActive = false
    dot.classList.remove("is-flying")
    dot.style.transform = "translate3d(0, 0, 0)"
  }

  const cancelGlow = (): void => {
    if (glowRaf !== 0) {
      window.cancelAnimationFrame(glowRaf)
      glowRaf = 0
    }
  }

  const pulsePower = (): void => {
    cancelGlow()
    const start = performance.now()

    const tick = (now: number): void => {
      const progress = Math.min((now - start) / 900, 1)
      setLit(0.9 * (1 - progress))

      if (progress < 1) {
        glowRaf = window.requestAnimationFrame(tick)
      } else {
        glowRaf = 0
        setLit(0)
      }
    }

    glowRaf = window.requestAnimationFrame(tick)
  }

  const finishOffline = (): void => {
    if (state !== "switching-off") {
      return
    }

    setState("offline")
    pulsePower()
  }

  const launchDot = (): void => {
    const startPoint = mapClipPoint(CLIP.origin.x, CLIP.origin.y)
    const footerRect = root.getBoundingClientRect()
    const powerRect = powerO.getBoundingClientRect()

    if (!startPoint) {
      finishOffline()
      return
    }

    const start = { x: startPoint.x, y: startPoint.y }
    const end = {
      x: powerRect.left + powerRect.width / 2 - footerRect.left,
      y: powerRect.top + powerRect.height / 2 - footerRect.top,
    }
    const dx = end.x - start.x
    const dy = end.y - start.y
    const length = Math.hypot(dx, dy) || 1
    const curve = Math.min(180, length * 0.18)
    const control = {
      x: (start.x + end.x) / 2 + (-dy / length) * curve,
      y: (start.y + end.y) / 2 + (dx / length) * curve,
    }
    const started = performance.now()

    dotActive = true
    dot.classList.add("is-flying")

    const tick = (now: number): void => {
      const t = Math.min((now - started) / CLIP.dotFlight, 1)
      const eased = cubicInOut(t)
      const x = quadratic(start.x, control.x, end.x, eased)
      const y = quadratic(start.y, control.y, end.y, eased)
      const scale = dotScale(t)

      dot.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${scale.toFixed(3)})`

      if (t < 1) {
        dotRaf = window.requestAnimationFrame(tick)
      } else {
        dotRaf = 0
        dotActive = false
        dot.classList.remove("is-flying")
        finishOffline()
      }
    }

    dotRaf = window.requestAnimationFrame(tick)
  }

  const reveal = (): void => {
    if (revealed) {
      return
    }

    revealed = true
    root.classList.add("is-visible")
    setState("arriving")
    void playFrom(CLIP.switchOnAt)
    ensureLoop()
  }

  const goOffline = (): void => {
    if (state === "waiting") {
      reveal()
    }

    setPressed(true)
    setState("switching-off")
    dotLaunched = false
    resetDot()
    cancelGlow()
    setLit(0)
    void playFrom(CLIP.idleAt)
    ensureLoop()
  }

  const goOnline = (): void => {
    setPressed(false)
    setState("switching-on")
    dotLaunched = false
    resetDot()
    cancelGlow()
    setLit(0)
    void playFrom(CLIP.switchOnAt)
    ensureLoop()
  }

  power.addEventListener("click", () => {
    if (state === "switching-off" || state === "reduced") {
      return
    }

    if (state === "offline") {
      goOnline()
      return
    }

    goOffline()
  })

  video.addEventListener("ended", () => {
    video.pause()

    if (state === "switching-off" && !dotLaunched) {
      dotLaunched = true
      launchDot()
    }
  })

  if (motionQuery.matches) {
    root.classList.add("is-visible", "is-reduced")
    setState("reduced")
    power.disabled = true
    power.setAttribute("aria-label", "Scene motion is disabled")
    power.title = "Scene motion is disabled"
    return
  }

  sky.width = 160
  sky.height = 90
  resize()

  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(root)

  if ("IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          reveal()
          revealObserver.disconnect()
        }
      },
      { threshold: 0.35 }
    )

    revealObserver.observe(root)

    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        inView = Boolean(entries[0]?.isIntersecting)

        if (inView) {
          ensureLoop()
        } else if (video.paused && !dotActive) {
          stopLoop()
        }
      },
      { threshold: 0 }
    )

    visibilityObserver.observe(root)
  } else {
    inView = true
    reveal()
    ensureLoop()
  }
}
