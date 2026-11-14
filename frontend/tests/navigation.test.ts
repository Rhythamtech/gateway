import test from "node:test"
import assert from "node:assert/strict"
import { postLoginPath } from "../src/lib/navigation.ts"

const origin = "https://gateway.example"

test("post-login navigation preserves local deep links", () => {
  assert.equal(
    postLoginPath("/dashboard/providers/detail?id=abc#models", origin),
    "/dashboard/providers/detail?id=abc#models"
  )
  assert.equal(
    postLoginPath("/dashboard/credits", origin),
    "/dashboard/credits"
  )
})

test("post-login navigation rejects external and parser-normalized destinations", () => {
  for (const path of [
    null,
    "",
    "https://outside.example",
    "//outside.example",
    "/\\outside.example",
    "/\n/outside.example",
    "/\t/outside.example",
    "javascript:alert(1)",
  ])
    assert.equal(postLoginPath(path, origin), "/dashboard", String(path))
})
