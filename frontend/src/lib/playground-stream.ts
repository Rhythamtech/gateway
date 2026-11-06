/** Chat-completions transport. UI snapshots are batched; wire parsing is lossless. */
export type RunSnapshot = {
  content: string
  /** Reasoning text explicitly returned by the provider, separate from the answer. */
  reasoning: string
  status: string
  raw: string
  headersMs: number
  firstEventMs: number | null
  firstAnswerMs: number | null
  terminalMs: number | null
  completionMs: number | null
  closeMs: number | null
  finishReason: string | null
  usage: {
    promptTokens: number | null
    completionTokens: number | null
    totalTokens: number | null
  } | null
}

const RAW_LIMIT = 32_768
const EVENT_LIMIT = 1_048_576
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null

export async function readChatResponse(
  response: Response,
  signal: AbortSignal,
  started: number,
  update: (snapshot: RunSnapshot) => void
): Promise<RunSnapshot> {
  const elapsed = () => Math.round(performance.now() - started)
  const state: RunSnapshot = {
    content: "",
    reasoning: "",
    status: "Receiving activity",
    raw: "",
    headersMs: elapsed(),
    firstEventMs: null,
    firstAnswerMs: null,
    terminalMs: null,
    completionMs: null,
    closeMs: null,
    finishReason: null,
    usage: null,
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let reasoning = false
  let terminal = false
  const publish = () => update({ ...state })
  const schedule = () => {
    timer ??= setTimeout(() => {
      timer = undefined
      publish()
    }, 50)
  }
  const log = (text: string) => {
    state.raw = (state.raw + text + "\n").slice(-RAW_LIMIT)
    schedule()
  }
  const consume = (value: unknown) => {
    if (!value || typeof value !== "object")
      throw new Error("Invalid response event: expected an object.")
    const data = value as Record<string, unknown>
    if (data.error) {
      const error = data.error as { message?: string }
      throw new Error(
        typeof error.message === "string"
          ? error.message
          : "Provider returned a stream error."
      )
    }
    const choice = (
      data.choices as
        | {
            delta?: Record<string, unknown>
            message?: Record<string, unknown>
            finish_reason?: string
          }[]
        | undefined
    )?.[0]
    const delta = choice?.delta ?? choice?.message
    const content = delta?.content
    if (typeof content === "string" && content) {
      state.firstAnswerMs ??= elapsed()
      state.content += content
      state.status = "Generating"
    }
    const reasoningText =
      typeof delta?.reasoning_content === "string" && delta.reasoning_content
        ? delta.reasoning_content
        : typeof delta?.reasoning === "string"
          ? delta.reasoning
          : ""
    if (reasoningText) {
      reasoning = true
      state.reasoning += reasoningText
      if (!state.content) state.status = "Thinking"
    }
    if (choice?.finish_reason) {
      state.finishReason = choice.finish_reason
      state.completionMs ??= elapsed()
    }
    if (data.usage && typeof data.usage === "object") {
      const usage = data.usage as Record<string, unknown>
      state.usage = {
        promptTokens: count(usage.prompt_tokens),
        completionTokens: count(usage.completion_tokens),
        totalTokens: count(usage.total_tokens),
      }
    }
    schedule()
  }
  publish()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const abort = () => {
    void reader?.cancel().catch(() => {})
  }
  signal.addEventListener("abort", abort, { once: true })
  try {
    const contentType =
      response.headers.get("content-type")?.toLowerCase() ?? ""
    if (contentType.includes("application/json")) {
      const data: unknown = await response.json()
      state.firstEventMs = elapsed()
      log(JSON.stringify(data))
      consume(data)
      terminal = true
      state.terminalMs = elapsed()
      state.closeMs = elapsed()
    } else if (contentType.includes("text/event-stream") && response.body) {
      reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let fields: string[] = []
      let eventType = ""
      const dispatch = () => {
        if (!fields.length) {
          eventType = ""
          return
        }
        const data = fields.join("\n")
        fields = []
        state.firstEventMs ??= elapsed()
        log(`event: ${eventType || "message"}\ndata: ${data}`)
        if (data.trim() === "[DONE]") {
          terminal = true
          state.terminalMs = elapsed()
          state.completionMs ??= elapsed()
        } else {
          let parsed: unknown
          try {
            parsed = JSON.parse(data)
          } catch {
            throw new Error("Malformed JSON in an SSE event.")
          }
          if (eventType === "error") {
            const error = parsed as {
              message?: string
              error?: { message?: string }
            }
            throw new Error(
              error.error?.message ??
                error.message ??
                "Provider returned a stream error."
            )
          }
          consume(parsed)
        }
        eventType = ""
      }
      const line = (value: string) => {
        if (!value) {
          dispatch()
          return
        }
        if (value.startsWith(":")) {
          state.firstEventMs ??= elapsed()
          log(value)
          return
        }
        const colon = value.indexOf(":")
        const name = colon < 0 ? value : value.slice(0, colon)
        const field = colon < 0 ? "" : value.slice(colon + 1).replace(/^ /, "")
        if (name === "data") fields.push(field)
        if (name === "event") eventType = field
        if (fields.reduce((sum, item) => sum + item.length, 0) > EVENT_LIMIT)
          throw new Error("SSE event exceeded the safety limit.")
      }
      while (!terminal) {
        signal.throwIfAborted()
        const { done, value } = await reader.read()
        signal.throwIfAborted()
        buffer += done
          ? decoder.decode()
          : decoder.decode(value, { stream: true })
        let match: RegExpExecArray | null
        // Keep trailing CR until the next read, so split CRLF is one delimiter.
        while ((match = /\r\n|\n|\r(?!$)/.exec(buffer)) && !terminal) {
          line(buffer.slice(0, match.index))
          buffer = buffer.slice(match.index + match[0].length)
        }
        if (buffer.length > EVENT_LIMIT)
          throw new Error("SSE line exceeded the safety limit.")
        if (done) {
          state.closeMs = elapsed()
          if (!terminal) {
            if (buffer) line(buffer.replace(/\r$/, ""))
            dispatch()
          }
          break
        }
      }
      if (!terminal && !state.finishReason)
        throw new Error("Stream interrupted before a completion signal.")
    } else {
      throw new Error(
        `Expected SSE or JSON; received ${contentType || "no Content-Type"}.`
      )
    }
    signal.throwIfAborted()
    state.completionMs ??= elapsed()
    state.status =
      state.finishReason === "length"
        ? "Output limit reached"
        : !state.content
          ? reasoning
            ? "Reasoning only — no answer returned"
            : "No answer returned"
          : "Completed"
    return state
  } catch (error) {
    state.status = signal.aborted
      ? "Stopped"
      : `Failed: ${error instanceof Error ? error.message : "Network error"}`
    throw error
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    signal.removeEventListener("abort", abort)
    if (reader) {
      // DONE is terminal even when the server keeps the connection open.
      void reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    publish()
  }
}
