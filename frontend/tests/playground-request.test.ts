import test from "node:test"
import assert from "node:assert/strict"
import {
  conversationHistory,
  requestSnippet,
  type ChatPayload,
} from "../src/lib/playground-request.ts"

test("history excludes placeholders, failures, reasoning-only and stopped partial answers", () => {
  const history = conversationHistory([
    { role: "user", content: "question" },
    { role: "assistant", content: "" },
    { role: "assistant", content: "Request Failed" },
    { role: "assistant", content: "(No response content returned)" },
    { role: "assistant", content: "partial", includeInHistory: false },
    { role: "assistant", content: "answer", includeInHistory: true },
  ])
  assert.deepEqual(history, [
    { role: "user", content: "question" },
    { role: "assistant", content: "answer" },
  ])
})
test("exports preserve dispatched payload independently of later draft changes", () => {
  const payload: ChatPayload = {
    model: "fixture/model",
    messages: [{ role: "user", content: "What's true?\nUnicode 🌍" }],
    temperature: 0.7,
    max_tokens: 5,
    top_p: 1,
    stream: true,
  }
  const dispatched = JSON.parse(JSON.stringify(payload)) as ChatPayload
  payload.messages.push({ role: "assistant", content: "later answer" })
  payload.model = "changed"
  const snippet = requestSnippet(
    dispatched,
    "typescript",
    "http://localhost:8000"
  )
  const exported = JSON.parse(
    snippet.slice(
      "const payload = ".length,
      snippet.indexOf(";\nconst response")
    )
  )
  assert.deepEqual(exported, dispatched)
  for (const language of ["curl", "python", "typescript"] as const) {
    const text = requestSnippet(dispatched, language, "http://localhost:8000")
    assert.match(text, /YOUR_API_KEY/)
    assert.doesNotMatch(text, /later answer|changed/)
  }
  assert.match(
    requestSnippet(dispatched, "curl", "http://localhost:8000"),
    /curl -N/
  )
  assert.match(
    requestSnippet(dispatched, "python", "http://localhost:8000"),
    /json.loads/
  )
})

test("long histories preserve intentional turns without UI states", () => {
  const messages = Array.from({ length: 1000 }, (_, i) => ({
    role: "user" as const,
    content: `prompt ${i}`,
  }))
  const result = conversationHistory([
    ...messages,
    { role: "assistant", content: "", includeInHistory: false },
  ])
  assert.equal(result.length, 1000)
  assert.deepEqual(result.at(-1), { role: "user", content: "prompt 999" })
})
