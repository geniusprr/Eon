import { createParser } from 'eventsource-parser'

export class ProviderError extends Error {
  constructor(message: string, readonly retryable = true, readonly retryAfterMs = 0) {
    super(message)
  }
}

export function canRetryStatus(status: number) {
  return status === 408 || status === 429 || status >= 500
}

interface ToolDelta {
  index: number
  id?: string
  function?: { name?: string; arguments?: string }
}

interface StreamChunk {
  error?: { code?: number }
  choices?: Array<{
    finish_reason?: string
    delta?: { content?: string; tool_calls?: ToolDelta[]; reasoning_details?: ReasoningDetail[] }
  }>
}

type ReasoningDetail = Record<string, unknown>

function appendReasoning(details: ReasoningDetail[], detail: ReasoningDetail) {
  const last = details.at(-1)
  const field = detail.type === 'reasoning.text' ? 'text' : detail.type === 'reasoning.summary' ? 'summary' : undefined
  if (field && last && last.type === detail.type && last.index === detail.index &&
      (!last.id || !detail.id || last.id === detail.id)) {
    details[details.length - 1] = {
      ...last, ...detail,
      [field]: `${last[field] ?? ''}${detail[field] ?? ''}`,
      signature: detail.signature ?? last.signature,
    }
  } else {
    details.push(detail)
  }
}

export async function readOpenRouterStream(
  body: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
  onActivity: () => void,
  maxTools: number,
) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const calls = new Map<number, { id: string; function: { name: string; arguments: string } }>()
  let reasoning: ReasoningDetail[] | undefined
  let content = ''
  let received = 0
  let done = false
  let finishReason: string | undefined
  const parser = createParser({
    maxBufferSize: 512_000,
    onError(error) {
      if (error.type === 'max-buffer-size-exceeded') throw new ProviderError('AI yanıtı çok uzun.', false)
    },
    onEvent({ data }) {
      if (done) return
      if (data === '[DONE]') { done = true; return }
      received += data.length
      if (received > 2_000_000) throw new ProviderError('AI yanıtı çok uzun.', false)
      const packet = JSON.parse(data) as StreamChunk
      const choice = packet.choices?.[0]
      if (packet.error || choice?.finish_reason === 'error') {
        const code = packet.error?.code
        throw new ProviderError('OpenRouter yanıt akışı kesildi.', typeof code !== 'number' || canRetryStatus(code))
      }
      if (!choice) return
      if (choice.finish_reason) finishReason = choice.finish_reason
      const delta = choice.delta
      if (!delta) return
      if (delta.content || delta.tool_calls?.length || delta.reasoning_details?.length || choice.finish_reason) onActivity()
      if (Array.isArray(delta.reasoning_details)) {
        reasoning ??= []
        for (const detail of delta.reasoning_details) appendReasoning(reasoning, detail)
      }
      for (const tool of delta.tool_calls ?? []) {
        if (!Number.isInteger(tool.index) || tool.index < 0 || tool.index >= maxTools) {
          throw new ProviderError('AI tek adımda çok fazla araç istedi.', false)
        }
        const call = calls.get(tool.index) ?? { id: '', function: { name: '', arguments: '' } }
        if (tool.id) call.id = tool.id
        if (tool.function?.name) call.function.name += tool.function.name
        if (tool.function?.arguments) call.function.arguments += tool.function.arguments
        if (call.function.arguments.length >= 12_000) throw new ProviderError('AI araç çağrısı çok uzun.', false)
        calls.set(tool.index, call)
      }
      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content
        if (content.length > 256_000) throw new ProviderError('AI yanıtı çok uzun.', false)
        onText(content)
      }
    },
  })
  try {
    while (!done) {
      const part = await reader.read()
      if (part.done) break
      parser.feed(decoder.decode(part.value, { stream: true }))
    }
    if (!done || !finishReason) throw new ProviderError('OpenRouter yanıt akışı tamamlanmadı.')
    if (calls.size && finishReason !== 'tool_calls' && finishReason !== 'stop') {
      throw new ProviderError('AI araç çağrısı tamamlanmadı.', false)
    }
    return {
      content,
      tool_calls: [...calls].sort(([left], [right]) => left - right).map(([, call]) => call),
      reasoning_details: reasoning,
    }
  } finally {
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
