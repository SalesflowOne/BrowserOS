import { ArrowLeft, Loader2, Send } from 'lucide-react'
import {
  type Dispatch,
  type FC,
  type SetStateAction,
  useRef,
  useState,
} from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { chatWithAgent } from './useOpenClaw'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface AgentChatProps {
  agentId: string
  agentName: string
  onBack: () => void
}

function appendDelta(
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  targetId: string,
  delta: string,
) {
  setMessages((prev) =>
    prev.map((m) =>
      m.id === targetId ? { ...m, content: m.content + delta } : m,
    ),
  )
}

function setMessageContent(
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  targetId: string,
  content: string,
) {
  setMessages((prev) =>
    prev.map((m) => (m.id === targetId ? { ...m, content } : m)),
  )
}

async function streamResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  assistantId: string,
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
) {
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6)
      if (data === '[DONE]') continue

      try {
        const parsed = JSON.parse(data)
        const delta = parsed.choices?.[0]?.delta?.content
        if (delta) appendDelta(setMessages, assistantId, delta)
      } catch {
        // Skip unparseable chunks
      }
    }
  }
}

export const AgentChat: FC<AgentChatProps> = ({
  agentId,
  agentName,
  onBack,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight)
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text || streaming) return

    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: 'user', content: text },
    ])
    setInput('')
    setStreaming(true)
    setTimeout(scrollToBottom, 0)

    const assistantId = crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: 'assistant', content: '' },
    ])

    try {
      const allMessages = [
        ...messagesRef.current.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        { role: 'user' as const, content: text },
      ]
      const response = await chatWithAgent(agentId, allMessages)

      if (!response.ok) {
        const err = await response.text()
        setMessageContent(setMessages, assistantId, `Error: ${err}`)
        return
      }

      const reader = response.body?.getReader()
      if (!reader) return

      await streamResponse(reader, assistantId, setMessages)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMessageContent(setMessages, assistantId, `Error: ${msg}`)
    } finally {
      setStreaming(false)
      setTimeout(scrollToBottom, 0)
    }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <h2 className="font-semibold text-lg">{agentName}</h2>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted'
              }`}
            >
              <pre className="whitespace-pre-wrap font-sans text-sm">
                {msg.content}
                {msg.role === 'assistant' && streaming && !msg.content && (
                  <Loader2 className="inline size-3 animate-spin" />
                )}
              </pre>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t p-4">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="Send a message..."
            className="min-h-[44px] resize-none"
            rows={1}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            size="icon"
          >
            {streaming ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
