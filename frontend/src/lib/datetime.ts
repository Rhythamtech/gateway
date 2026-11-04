// Timestamp display helpers.
//
// Contract: the backend stores and returns every timestamp in UTC, serialized
// as ISO 8601 with a trailing "Z" (e.g. 2026-11-04T02:23:00Z). Conversion to
// the viewer's timezone happens here, at display time, so every user sees
// times matching their own device.

// The device timezone (IANA name, e.g. "Asia/Kolkata"); mirrors what
// Date.toLocaleString() would implicitly use, but explicit and reusable.
export function getUserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

// Parse an API timestamp into a Date at the instant it represents.
//
// "Z" / offset-suffixed values parse directly. A defensive fallback treats an
// offset-less string as UTC (the storage format) instead of device-local time,
// which would silently shift the displayed instant; unparsable non-empty
// strings return null so callers can render the raw value.
export function parseApiTimestamp(
  value: string | null | undefined
): Date | null {
  if (value === null || value === undefined) return null
  const text = value.trim()
  if (!text) return null
  // T-separator ISO (the API contract), with or without an offset suffix.
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
  const date = new Date(hasZone ? text : `${text}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

// Format a Date as an instant in the viewer's device timezone.
export function formatTimestampInDeviceZone(date: Date): string {
  return date.toLocaleString("en-US", { timeZone: getUserTimeZone() })
}
