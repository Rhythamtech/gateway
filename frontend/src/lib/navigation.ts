/** Keep post-login navigation on this origin, including URL-parser edge cases. */
export function postLoginPath(
  requested: string | null,
  origin: string
): string {
  if (!requested?.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(requested))
    return "/dashboard"
  try {
    const target = new URL(requested, origin)
    return target.origin === origin
      ? `${target.pathname}${target.search}${target.hash}`
      : "/dashboard"
  } catch {
    return "/dashboard"
  }
}
