import assert from "node:assert/strict"
import test from "node:test"

import {
  getCurrentUser,
  getPlaygroundApiKey,
  hasAuthTokens,
} from "../src/lib/auth.ts"

for (const failure of ["offline", 503, 401] as const) {
  test(`refresh handles ${failure} without losing retryable sessions`, async (t) => {
    const storage = new Map([
      ["gateway.access_token", "expired-access"],
      ["gateway.refresh_token", "valid-refresh"],
      ["gateway.playground_api_key", "playground-key"],
    ])
    t.mock.method(
      globalThis,
      "fetch",
      async (input: string, init: RequestInit) => {
        if (input.endsWith("/auth/refresh")) {
          if (failure === "offline" && !online) throw new TypeError("Offline")
          if (!online) return new Response(null, { status: Number(failure) })
          return Response.json({
            access_token: "new-access",
            refresh_token: "new-refresh",
          })
        }
        if (
          new Headers(init.headers).get("Authorization") !== "Bearer new-access"
        ) {
          return new Response(null, { status: 401 })
        }
        return Response.json({ id: "current-user" })
      }
    )
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        sessionStorage: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => storage.set(key, value),
          removeItem: (key: string) => storage.delete(key),
        },
      },
    })
    t.after(() => {
      if (previousWindow)
        Object.defineProperty(globalThis, "window", previousWindow)
      else Reflect.deleteProperty(globalThis, "window")
    })
    let online = false

    await assert.rejects(getCurrentUser())
    if (failure === 401) {
      assert.equal(hasAuthTokens(), false)
      assert.equal(getPlaygroundApiKey(), null)
      return
    }

    assert.equal(storage.get("gateway.refresh_token"), "valid-refresh")
    assert.equal(getPlaygroundApiKey(), "playground-key")
    online = true
    assert.equal((await getCurrentUser()).id, "current-user")
    assert.equal(storage.get("gateway.refresh_token"), "new-refresh")
  })
}
