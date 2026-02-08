import { useState, useRef, useEffect, useMemo, Fragment, memo } from 'react'
import { useStore, ToolCall } from '../store'
import { Message, stripAnsi } from '../lib/openclaw-client'
import { format, isSameDay } from 'date-fns'
import { marked } from 'marked'
import logoUrl from '../../build/icon.png'

// Configure marked for chat-friendly rendering: single newlines become <br>,
// GFM tables/strikethrough enabled, synchronous parsing.
marked.setOptions({ breaks: true, gfm: true, async: false })

export function ChatArea() {
  const { messages: allMessages, isStreaming, hadStreamChunks, agents, currentAgentId, activeToolCalls } = useStore()
  const messages = useMemo(
    () => allMessages.filter((m) => m.role !== 'system'),
    [allMessages]
  )
  const chatEndRef = useRef<HTMLDivElement>(null)
  const currentAgent = agents.find((a) => a.id === currentAgentId)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, activeToolCalls])

  if (messages.length === 0) {
    return (
      <div className="chat-area">
        <div className="chat-empty">
          <div className="empty-logo">
            <img src={logoUrl} alt="ClawControl logo" />
          </div>
          <h2>Start a Conversation</h2>
          <p>Send a message to begin chatting with {currentAgent?.name || 'the AI assistant'}</p>
          <div className="quick-actions">
            <button className="quick-action">
              <span>Explain a concept</span>
            </button>
            <button className="quick-action">
              <span>Help me code</span>
            </button>
            <button className="quick-action">
              <span>Analyze data</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-area">
      <div className="chat-container">
        {messages.map((message, index) => {
          const isNewDay = index === 0 || !isSameDay(new Date(message.timestamp), new Date(messages[index - 1].timestamp))
          
          return (
            <Fragment key={message.id}>
              {isNewDay && <DateSeparator date={new Date(message.timestamp)} />}
              <MessageBubble
                message={message}
                agentName={currentAgent?.name}
              />
            </Fragment>
          )
        })}

        {activeToolCalls.length > 0 && (
          <div className="tool-calls-container">
            {activeToolCalls.map((tc) => (
              <ToolCallBlock key={tc.toolCallId} toolCall={tc} />
            ))}
          </div>
        )}

        {isStreaming && !hadStreamChunks && (
          <div className="message agent typing-indicator-container">
            <div className="message-avatar">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 011 1v3a1 1 0 01-1 1h-1v1a2 2 0 01-2 2H5a2 2 0 01-2-2v-1H2a1 1 0 01-1-1v-3a1 1 0 011-1h1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2zm-4 12a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm8 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" />
              </svg>
            </div>
            <div className="message-content">
              <div className="typing-indicator">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>
    </div>
  )
}

function DateSeparator({ date }: { date: Date }) {
  let dateText = ''
  try {
    dateText = format(date, 'EEEE, MMMM d, yyyy')
  } catch (e) {
    return null
  }

  return (
    <div className="date-separator">
      <span>{dateText}</span>
    </div>
  )
}

const MessageBubble = memo(function MessageBubble({
  message,
  agentName
}: {
  message: Message
  agentName?: string
}) {
  const isUser = message.role === 'user'
  const time = format(new Date(message.timestamp), 'h:mm a')

  return (
    <div className={`message ${isUser ? 'user' : 'agent'}`}>
      {!isUser && (
        <div className="message-avatar">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 011 1v3a1 1 0 01-1 1h-1v1a2 2 0 01-2 2H5a2 2 0 01-2-2v-1H2a1 1 0 01-1-1v-3a1 1 0 011-1h1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2zm-4 12a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm8 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" />
          </svg>
        </div>
      )}

      <div className="message-content">
        <div className="message-header">
          {isUser ? (
            <>
              <span className="message-time">{time}</span>
              <span className="message-author">You</span>
            </>
          ) : (
            <>
              <span className="message-author">{agentName || 'Assistant'}</span>
              <span className="message-time">{time}</span>
            </>
          )}
        </div>
        <div className="message-bubble">
          {message.thinking && (
            <div className="thinking-block">
              <div className="thinking-header">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
                <span>Thinking...</span>
              </div>
              <div className="thinking-content">{message.thinking}</div>
            </div>
          )}
          <MessageContent content={message.content} />
        </div>
      </div>

      {isUser && (
        <div className="message-avatar user-avatar">
          <span>You</span>
        </div>
      )}
    </div>
  )
})

function ToolCallBlock({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const isRunning = toolCall.phase === 'start'

  return (
    <div className={`tool-call-block ${isRunning ? 'running' : 'completed'}`}>
      <button className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        {isRunning ? (
          <svg className="tool-call-icon spinning" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        ) : (
          <svg className="tool-call-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        )}
        <span className="tool-call-name">{toolCall.name}</span>
        <span className="tool-call-status">{isRunning ? 'Running...' : 'Done'}</span>
        <svg className={`tool-call-chevron ${expanded ? 'expanded' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {expanded && toolCall.result && (
        <div className="tool-call-result">
          <pre>{stripAnsi(toolCall.result)}</pre>
        </div>
      )}
    </div>
  )
}

function MessageContent({ content }: { content: string }) {
  const html = useMemo(
    () => marked.parse(stripAnsi(content), { async: false }) as string,
    [content]
  )
  return <div className="markdown-content" dangerouslySetInnerHTML={{ __html: html }} />
}
