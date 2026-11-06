import test from "node:test"
import assert from "node:assert/strict"
import {
  readChatResponse,
  type RunSnapshot,
} from "../src/lib/playground-stream.ts"

const encode = new TextEncoder()
const event = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`
const answer = (text: string) => ({ choices: [{ delta: { content: text } }] })
function response(chunks: string[], close = true) {
  let cancelled = false
  return {
    response: new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encode.encode(chunk))
          if (close) controller.close()
        },
        cancel() {
          cancelled = true
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } }
    ),
    cancelled: () => cancelled,
  }
}
const read = (r: Response, update: (s: RunSnapshot) => void = () => {}) =>
  readChatResponse(r, new AbortController().signal, performance.now(), update)

test("arbitrary character boundaries, CRLF, comments, reasoning, final usage and DONE without close", async () => {
  const wire =
    ": heartbeat\r\n\r\n" +
    event({ choices: [{ delta: { reasoning_content: "private thought" } }] }) +
    event(answer("Hi 🌍")) +
    event({ choices: [{ delta: {}, finish_reason: "stop" }] }) +
    event({ choices: [], usage: { prompt_tokens: 0, completion_tokens: 4 } }) +
    "data:[DONE]\r\n\r\n"
  const fixture = response([...wire], false)
  const result = await read(fixture.response)
  assert.equal(result.content, "Hi 🌍")
  assert.equal(result.status, "Completed")
  assert.equal(result.usage?.promptTokens, 0)
  assert.equal(result.usage?.totalTokens, null)
  assert.equal(result.closeMs, null)
  assert.ok(result.firstEventMs !== null && result.firstAnswerMs !== null)
  assert.equal(fixture.cancelled(), true)
})
test("multiline data, ignored fields and final partial event", async () => {
  const result = await read(
    response([
      'id: 1\nretry: 100\ndata: {"choices":\ndata: [{"delta":{"content":"answer"},"finish_reason":"stop"}]}',
    ]).response
  )
  assert.equal(result.content, "answer")
  assert.notEqual(result.closeMs, null)
})
test("reasoning-only and empty completions are distinct from answers", async () => {
  const reasoning = await read(
    response([
      event({ choices: [{ delta: { reasoning: "thinking" } }] }),
      "data: [DONE]\n\n",
    ]).response
  )
  assert.match(reasoning.status, /Reasoning only/)
  assert.equal(reasoning.content, "")
  assert.equal(reasoning.firstAnswerMs, null)
  const empty = await read(response(["data: [DONE]\n\n"]).response)
  assert.equal(empty.status, "No answer returned")
})
test("malformed events, SSE errors and truncated EOF surface errors with partial answer", async () => {
  for (const tail of [
    "data: broken\n\n",
    event({ error: { message: "upstream failed" } }),
    'event: error\ndata: {"message":"upstream failed"}\n\n',
    "",
  ]) {
    let last: RunSnapshot | undefined
    await assert.rejects(
      read(response([event(answer("partial")), tail]).response, (s) => {
        last = s
      })
    )
    assert.equal(last?.content, "partial")
    assert.match(last?.status ?? "", /^Failed:/)
  }
})
test("JSON fallback, null usage and output limit", async () => {
  const result = await read(
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "limited" }, finish_reason: "length" }],
        usage: { completion_tokens: null },
      }),
      { headers: { "Content-Type": "application/json" } }
    )
  )
  assert.equal(result.status, "Output limit reached")
  assert.equal(result.usage?.completionTokens, null)
  await assert.rejects(
    read(new Response("<html>bad gateway</html>")),
    /Expected SSE or JSON/
  )
})
test("live activity is published before answer; cancellation flushes partial text", async () => {
  const abort = new AbortController()
  let stream: ReadableStreamDefaultController<Uint8Array>
  let last: RunSnapshot | undefined
  const r = new Response(
    new ReadableStream({
      start(c) {
        stream = c
        c.enqueue(
          encode.encode(
            event({ choices: [{ delta: { reasoning_content: "thinking" } }] })
          )
        )
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } }
  )
  const promise = readChatResponse(r, abort.signal, performance.now(), (s) => {
    last = s
  })
  await new Promise((resolve) => setTimeout(resolve, 75))
  assert.equal(last?.status, "Thinking")
  assert.match(last?.raw ?? "", /reasoning_content/)
  stream!.enqueue(encode.encode(event(answer("partial"))))
  await new Promise((resolve) => setTimeout(resolve, 0))
  abort.abort()
  await assert.rejects(promise)
  assert.equal(last?.status, "Stopped")
  assert.equal(last?.content, "partial")
})
test("long stream preserves all text with bounded diagnostics and batched updates", async () => {
  let updates = 0
  const result = await read(
    response([event(answer("a".repeat(100))).repeat(2000), "data: [DONE]\n\n"])
      .response,
    () => {
      updates++
    }
  )
  assert.equal(result.content.length, 200_000)
  assert.ok(result.raw.length <= 32_768)
  assert.ok(updates < 10)
})

test("UTF-8 bytes can split inside multibyte characters", async () => {
  const bytes = encode.encode(event(answer("🌍 café")) + "data: [DONE]\n\n")
  const r = new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
        controller.close()
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } }
  )
  assert.equal((await read(r)).content, "🌍 café")
})
