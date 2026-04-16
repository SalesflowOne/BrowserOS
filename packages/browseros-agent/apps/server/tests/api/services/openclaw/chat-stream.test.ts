import { describe, expect, it } from 'bun:test'
import { parseOpenAiSseEvent } from '../../../../src/api/services/openclaw/chat-stream'

describe('parseOpenAiSseEvent', () => {
  it('parses a text-delta chunk', () => {
    const chunk = {
      choices: [{ delta: { content: 'hello ' } }],
    }
    const events = parseOpenAiSseEvent(chunk)
    expect(events).toEqual([{ type: 'text-delta', data: { text: 'hello ' } }])
  })

  it('emits nothing for finish_reason-only chunks (terminator comes via [DONE])', () => {
    const chunk = {
      choices: [{ delta: {}, finish_reason: 'stop' }],
    }
    expect(parseOpenAiSseEvent(chunk)).toEqual([])
  })

  it('ignores unrelated chunks', () => {
    const chunk = { id: 'abc', object: 'chat.completion.chunk', choices: [] }
    expect(parseOpenAiSseEvent(chunk)).toEqual([])
  })
})
