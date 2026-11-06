export type ModelMessage = {
  role: "system" | "user" | "assistant"
  content: string
}
export type ChatPayload = {
  model: string
  messages: ModelMessage[]
  temperature: number
  max_tokens: number
  top_p: number
  stream: boolean
}

/** Assistant UI states are excluded unless an answer completed successfully.
 * Stopped/failed partial answers remain visible but are not follow-up context.
 */
export function conversationHistory(
  messages: (ModelMessage & { includeInHistory?: boolean })[]
): ModelMessage[] {
  return messages
    .filter(
      (m) =>
        m.content.trim() &&
        (m.role !== "assistant" || m.includeInHistory === true)
    )
    .map(({ role, content }) => ({ role, content }))
}

export function requestSnippet(
  payload: ChatPayload,
  language: "curl" | "python" | "typescript",
  baseUrl: string
): string {
  const json = JSON.stringify(payload, null, 2)
  if (language === "curl") {
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
    return `curl -N -X POST ${quote(`${baseUrl}/v1/chat/completions`)} \\\n  -H 'Content-Type: application/json' \\\n  -H 'x-api-key: YOUR_API_KEY' \\\n  --data-raw ${quote(json)}`
  }
  if (language === "python") {
    return `import json\nimport urllib.request\n\npayload = json.loads(${JSON.stringify(json)})\nrequest = urllib.request.Request(\n    ${JSON.stringify(`${baseUrl}/v1/chat/completions`)},\n    data=json.dumps(payload).encode(),\n    headers={"Content-Type": "application/json", "x-api-key": "YOUR_API_KEY"},\n)\nwith urllib.request.urlopen(request) as response:\n    for line in response:\n        print(line.decode(), end="", flush=True)\n`
  }
  return `const payload = ${json};\nconst response = await fetch(${JSON.stringify(`${baseUrl}/v1/chat/completions`)}, {\n  method: "POST",\n  headers: {"Content-Type": "application/json", "x-api-key": "YOUR_API_KEY"},\n  body: JSON.stringify(payload),\n});\nif (!response.ok) {\n  throw new Error("HTTP " + response.status + ": " + await response.text());\n}\nif (response.body) {\n  for await (const text of response.body.pipeThrough(new TextDecoderStream())) {\n    console.log(text);\n  }\n}\n`
}
