// OpenClaw Client - Custom Frame-based Protocol (v3)

// Strip ANSI escape sequences (colors, cursor movement, mode switches, OSC, etc.)
// so terminal output from tool calls and streaming text renders cleanly in the UI.
// Uses inline regexes to avoid lastIndex state issues with reused global RegExp objects.
export function stripAnsi(text: string): string {
  return text
    // Standard CSI sequences: ESC[ ... final_byte
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    // OSC sequences: ESC] ... BEL  or  ESC] ... ST(ESC\)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    // ESC + single character sequences (charset selection, etc.)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[()#][A-Z0-9]/g, '')
    // Remaining ESC + one character (e.g. ESC>, ESC=, ESCM, etc.)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b[A-Z=><!*+\-\/]/gi, '')
    // C1 control codes (0x80-0x9F range, e.g. \x9b as CSI)
    // eslint-disable-next-line no-control-regex
    .replace(/\x9b[0-9;?]*[A-Za-z]/g, '')
    // Bell character
    // eslint-disable-next-line no-control-regex
    .replace(/\x07/g, '')
}

// Extract displayable text from a tool result payload.
// The server sends result as { content: [{ type: "text", text: "..." }, ...] }
// or as a plain string (rare). Returns undefined if no text can be extracted.
function extractToolResultText(result: unknown): string | undefined {
  if (typeof result === 'string') return result
  if (!result || typeof result !== 'object') return undefined

  const record = result as Record<string, unknown>
  const content = Array.isArray(record.content) ? record.content : null
  if (!content) {
    // Maybe the result is { text: "..." } or { output: "..." }
    if (typeof record.text === 'string') return record.text
    if (typeof record.output === 'string') return record.output
    return undefined
  }

  const texts = content
    .filter((c: any) => c && typeof c === 'object' && typeof c.text === 'string')
    .map((c: any) => c.text as string)
  return texts.length > 0 ? texts.join('\n') : undefined
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  thinking?: string
}

export interface Session {
  id: string
  key: string
  title: string
  agentId?: string
  createdAt: string
  updatedAt: string
  lastMessage?: string
  spawned?: boolean
  parentSessionId?: string
}

export interface Agent {
  id: string
  name: string
  description?: string
  status: 'online' | 'offline' | 'busy'
  avatar?: string
  emoji?: string
  theme?: string
  model?: string
  thinkingLevel?: string
  timeout?: number
  configured?: boolean
}

export interface AgentFile {
  name: string
  path: string
  missing: boolean
  size?: number
  updatedAtMs?: number
  content?: string
}

export interface SkillRequirements {
  bins: string[]
  anyBins: string[]
  env: string[]
  config: string[]
  os: string[]
}

export interface SkillInstallOption {
  id: string
  kind: string
  label: string
  bins?: string[]
}

export interface Skill {
  id: string
  name: string
  description: string
  triggers: string[]
  enabled?: boolean
  content?: string
  // Extended metadata from skills.status
  emoji?: string
  homepage?: string
  source?: string
  bundled?: boolean
  filePath?: string
  eligible?: boolean
  always?: boolean
  requirements?: SkillRequirements
  missing?: SkillRequirements
  install?: SkillInstallOption[]
}

export interface CronJob {
  id: string
  name: string
  schedule: string
  nextRun?: string
  status: 'active' | 'paused'
  description?: string
  content?: string
}

interface RequestFrame {
  type: 'req'
  id: string
  method: string
  params?: any
}

interface ResponseFrame {
  type: 'res'
  id: string
  ok: boolean
  payload?: any
  error?: {
    code: string
    message: string
    details?: any
  }
}

interface EventFrame {
  type: 'event'
  event: string
  payload?: any
}

type EventHandler = (...args: unknown[]) => void

export class OpenClawClient {
  private ws: WebSocket | null = null
  private url: string
  private token: string
  private authMode: 'token' | 'password'
  private requestId = 0
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }>()
  private eventHandlers = new Map<string, Set<EventHandler>>()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private authenticated = false
  private activeStreamSource: 'chat' | 'agent' | null = null
  private assistantStreamText = ''
  private assistantStreamMode: 'delta' | 'cumulative' | null = null
  private currentBlockOffset = 0
  private streamStarted = false
  private activeRunId: string | null = null
  private activeSessionKey: string | null = null
  _debugId = Math.random().toString(36).slice(2, 8)

  constructor(url: string, token: string = '', authMode: 'token' | 'password' = 'token') {
    this.url = url
    this.token = token
    this.authMode = authMode
    console.log('[ClawControl] new OpenClawClient created, debugId:', this._debugId)
  }

  // Event handling
  on(event: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler)
  }

  off(event: string, handler: EventHandler): void {
    this.eventHandlers.get(event)?.delete(handler)
  }

  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(event)
    if (event === 'streamChunk') {
      console.log('[ClawControl] client.emit(streamChunk) handlerCount:', handlers?.size ?? 0, 'clientId:', this._debugId)
    }
    handlers?.forEach((handler) => {
      try {
        handler(...args)
      } catch {
        // Event handler error - silently ignore
      }
    })
  }

  // Connection management
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url)

        this.ws.onopen = () => {
          this.reconnectAttempts = 0
        }

        this.ws.onerror = (error) => {
          // Check if this might be a certificate error (wss:// that failed to connect)
          if (this.url.startsWith('wss://') && this.ws?.readyState === WebSocket.CLOSED) {
            try {
              const urlObj = new URL(this.url)
              const httpsUrl = `https://${urlObj.host}`
              this.emit('certError', { url: this.url, httpsUrl })
              reject(new Error(`Certificate error - visit ${httpsUrl} to accept the certificate`))
              return
            } catch {
              // URL parsing failed, fall through to generic error
            }
          }

          this.emit('error', error)
          reject(new Error('WebSocket connection failed'))
        }

        this.ws.onclose = () => {
          this.authenticated = false
          this.resetStreamState()
          this.emit('disconnected')
          this.attemptReconnect()
        }

        this.ws.onmessage = (event) => {
          const incoming = (event as MessageEvent).data
          if (typeof incoming === 'string') {
            this.handleMessage(incoming, resolve, reject)
            return
          }

          // Some runtimes deliver WebSocket frames as Blob/ArrayBuffer.
          if (incoming instanceof Blob) {
            incoming.text().then((text) => {
              this.handleMessage(text, resolve, reject)
            }).catch(() => {})
            return
          }

          if (incoming instanceof ArrayBuffer) {
            try {
              const text = new TextDecoder().decode(new Uint8Array(incoming))
              this.handleMessage(text, resolve, reject)
            } catch {
              // ignore
            }
            return
          }

          // Unknown frame type; ignore.
        }
      } catch (error) {
        reject(error)
      }
    })
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return
    }

    this.reconnectAttempts++
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)

    setTimeout(() => {
      this.connect().catch(() => {})
    }, delay)
  }

  disconnect(): void {
    this.maxReconnectAttempts = 0 // Prevent auto-reconnect
    if (this.ws) {
      // Null out handlers BEFORE close() so the socket stops processing
      // messages immediately. ws.close() is async — without this, events
      // arriving during the CLOSING state still trigger handleMessage.
      this.ws.onmessage = null
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.close()
    }
    this.ws = null
    this.authenticated = false
    this.resetStreamState()
  }

  private async performHandshake(_nonce?: string): Promise<void> {
    const id = (++this.requestId).toString()
    const connectMsg: RequestFrame = {
      type: 'req',
      id,
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        role: 'operator',
        client: {
          id: 'gateway-client',
          displayName: 'ClawControl',
          version: '1.0.0',
          platform: 'web',
          mode: 'backend'
        },
        auth: this.token
            ? (this.authMode === 'password' ? { password: this.token } : { token: this.token })
            : undefined
      }
    }

    this.ws?.send(JSON.stringify(connectMsg))
  }

  // RPC methods
  private async call<T>(method: string, params?: any): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to OpenClaw')
    }

    const id = (++this.requestId).toString()
    const request: RequestFrame = {
      type: 'req',
      method,
      params,
      id
    }

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject
      })

      this.ws!.send(JSON.stringify(request))

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error(`Request timeout: ${method}`))
        }
      }, 30000)
    })
  }

  private handleMessage(data: string, resolve?: () => void, reject?: (err: Error) => void): void {
    try {
      const message = JSON.parse(data)
      
      // 1. Handle Events
      if (message.type === 'event') {
        const eventFrame = message as EventFrame
        
        // Special case: Handshake Challenge
        if (eventFrame.event === 'connect.challenge') {
          this.performHandshake(eventFrame.payload?.nonce).catch((err) => {
            reject?.(err)
          })
          return
        }

        this.handleNotification(eventFrame.event, eventFrame.payload)
        return
      }

      // 2. Handle Responses
      if (message.type === 'res') {
        const resFrame = message as ResponseFrame
        const pending = this.pendingRequests.get(resFrame.id)

        // Special case: Initial Connect Response
        if (!this.authenticated && resFrame.ok && resFrame.payload?.type === 'hello-ok') {
          this.authenticated = true
          this.emit('connected', resFrame.payload)
          resolve?.()
          return
        }

        if (pending) {
          this.pendingRequests.delete(resFrame.id)
          if (resFrame.ok) {
            pending.resolve(resFrame.payload)
          } else {
            const errorMsg = resFrame.error?.message || 'Unknown error'
            pending.reject(new Error(errorMsg))
          }
        } else if (!resFrame.ok && !this.authenticated) {
          // Failed connect response
          const errorMsg = resFrame.error?.message || 'Handshake failed'
          reject?.(new Error(errorMsg))
        }
        return
      }
    } catch {
      // Failed to parse message
    }
  }

  private extractTextFromContent(content: unknown): string {
    let text = ''
    if (typeof content === 'string') {
      text = content
    } else if (Array.isArray(content)) {
      text = content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('')
    } else if (content && typeof content === 'object' && 'text' in content) {
      text = String((content as any).text)
    }
    return stripAnsi(text)
  }

  private isHeartbeatContent(text: string): boolean {
    const upper = text.toUpperCase()
    return upper.includes('HEARTBEAT_OK') || upper.includes('HEARTBEAT.MD')
  }

  private resetStreamState(): void {
    this.activeStreamSource = null
    this.assistantStreamText = ''
    this.assistantStreamMode = null
    this.currentBlockOffset = 0
    this.streamStarted = false
    this.activeRunId = null
    this.activeSessionKey = null
  }

  private maybeUpdateRunAndSession(runId?: unknown, sessionKey?: unknown): void {
    if (typeof runId === 'string' && this.activeRunId && this.activeRunId !== runId) {
      // A new run started before we observed a clean end. Treat as a reset.
      this.resetStreamState()
    }

    if (typeof runId === 'string' && !this.activeRunId) {
      this.activeRunId = runId
    }

    if (typeof sessionKey === 'string' && sessionKey && this.activeSessionKey !== sessionKey) {
      this.activeSessionKey = sessionKey
      this.emit('streamSessionKey', { runId, sessionKey })
    }
  }

  private ensureStream(source: 'chat' | 'agent', modeHint: 'delta' | 'cumulative', runId?: unknown): void {
    this.maybeUpdateRunAndSession(runId)

    if (this.activeStreamSource === null) {
      this.activeStreamSource = source
    }

    if (this.activeStreamSource !== source) {
      return
    }

    if (!this.assistantStreamMode) {
      this.assistantStreamMode = modeHint
    }

    if (!this.streamStarted) {
      this.streamStarted = true
      this.emit('streamStart')
    }
  }

  private applyStreamText(nextText: string): void {
    if (!nextText) return

    const previous = this.assistantStreamText
    if (nextText === previous) return

    if (!previous) {
      this.assistantStreamText = nextText
      this.emit('streamChunk', nextText)
      return
    }

    if (nextText.startsWith(previous)) {
      const append = nextText.slice(previous.length)
      this.assistantStreamText = nextText
      if (append) {
        this.emit('streamChunk', append)
      }
      return
    }

    // New content block — accumulate rather than replace.
    const separator = '\n\n'
    this.assistantStreamText = this.assistantStreamText + separator + nextText
    this.emit('streamChunk', separator + nextText)
  }

  private mergeIncoming(incoming: string, modeHint: 'delta' | 'cumulative'): string {
    const previous = this.assistantStreamText

    if (modeHint === 'cumulative') {
      if (!previous) return incoming
      if (incoming === previous) return previous

      // Normal cumulative growth: incoming extends the full accumulated text
      if (incoming.startsWith(previous)) return incoming

      // Check if incoming extends just the current content block
      // (agent data.text is cumulative per-block, resetting on tool calls)
      const currentBlock = previous.slice(this.currentBlockOffset)
      if (currentBlock && incoming.startsWith(currentBlock)) {
        return previous.slice(0, this.currentBlockOffset) + incoming
      }

      // New content block detected — accumulate rather than replace.
      // The server's data.text resets per content block (e.g. after tool calls
      // or when transitioning from thinking to response). Append with a
      // separator so earlier text is preserved during streaming. The final
      // chat message event will replace the placeholder with the correct text.
      const separator = '\n\n'
      this.currentBlockOffset = previous.length + separator.length
      return previous + separator + incoming
    }

    // Some servers send cumulative strings even in "delta" fields.
    if (previous && incoming.startsWith(previous)) {
      return incoming
    }

    // Some servers repeat a suffix; avoid regressions.
    if (previous && previous.endsWith(incoming)) {
      return previous
    }

    // Fallback for partial overlap between chunk boundaries.
    if (previous) {
      const maxOverlap = Math.min(previous.length, incoming.length)
      for (let i = maxOverlap; i > 0; i--) {
        if (previous.endsWith(incoming.slice(0, i))) {
          return previous + incoming.slice(i)
        }
      }
    }

    return previous + incoming
  }

  private handleNotification(event: string, payload: any): void {
    if (event === 'agent' && payload.stream === 'assistant') {
      console.log('[ClawControl] handleNotification agent:assistant clientId:', this._debugId, 'activeStreamSource:', this.activeStreamSource)
    }
    switch (event) {
      case 'chat':
        if (payload.state === 'delta') {
          this.maybeUpdateRunAndSession(payload.runId, payload.sessionKey)
          this.ensureStream('chat', 'cumulative', payload.runId)
          if (this.activeStreamSource !== 'chat') {
            // Another stream type already claimed this response.
            return
          }

          const rawText = payload.message?.content !== undefined
            ? this.extractTextFromContent(payload.message.content)
            : (typeof payload.delta === 'string' ? stripAnsi(payload.delta) : '')

          if (rawText && !this.isHeartbeatContent(rawText)) {
            const nextText = this.mergeIncoming(rawText, 'cumulative')
            this.applyStreamText(nextText)
          }
          return
        } else if (payload.state === 'final') {
          this.maybeUpdateRunAndSession(payload.runId, payload.sessionKey)

          // If the agent stream handled this response, lifecycle:end already
          // emitted streamEnd and reset state. Skip to avoid duplicates.
          if (this.activeStreamSource === 'agent') {
            return
          }

          if (payload.message) {
            const text = this.extractTextFromContent(payload.message.content)
            if (text && !this.isHeartbeatContent(text)) {
              const id =
                (typeof payload.message.id === 'string' && payload.message.id) ||
                (typeof payload.runId === 'string' && payload.runId) ||
                `msg-${Date.now()}`
              const tsRaw = payload.message.timestamp
              const tsNum = typeof tsRaw === 'number' ? tsRaw : NaN
              const tsMs = Number.isFinite(tsNum) ? (tsNum > 1e12 ? tsNum : tsNum * 1000) : Date.now()
              this.emit('message', {
                id,
                role: payload.message.role,
                content: text,
                timestamp: new Date(tsMs).toISOString()
              })
            }
          }

          if (this.streamStarted) {
            this.emit('streamEnd')
          }
          this.resetStreamState()
        }
        break
      case 'presence':
        this.emit('agentStatus', payload)
        break
      case 'agent':
        if (payload.stream === 'assistant') {
          this.maybeUpdateRunAndSession(payload.runId, payload.sessionKey)
          const hasCanonicalText = typeof payload.data?.text === 'string'
          this.ensureStream('agent', hasCanonicalText ? 'cumulative' : 'delta', payload.runId)
          if (this.activeStreamSource !== 'agent') {
            // Another stream type already claimed this response.
            return
          }

          // Prefer canonical cumulative text when available. Delta fields can be inconsistent.
          const canonicalText = typeof payload.data?.text === 'string' ? stripAnsi(payload.data.text) : ''
          if (canonicalText && !this.isHeartbeatContent(canonicalText)) {
            const nextText = this.mergeIncoming(canonicalText, 'cumulative')
            this.applyStreamText(nextText)
            return
          }

          const deltaText = typeof payload.data?.delta === 'string' ? stripAnsi(payload.data.delta) : ''
          if (deltaText && !this.isHeartbeatContent(deltaText)) {
            const nextText = this.mergeIncoming(deltaText, 'delta')
            this.applyStreamText(nextText)
          }
        } else if (payload.stream === 'tool') {
          this.maybeUpdateRunAndSession(payload.runId, payload.sessionKey)

          if (!this.streamStarted) {
            this.streamStarted = true
            this.emit('streamStart')
          }

          const data = payload.data || {}
          const rawResult = extractToolResultText(data.result)
          const toolPayload = {
            toolCallId: data.toolCallId || data.id || `tool-${Date.now()}`,
            name: data.name || data.toolName || 'unknown',
            phase: data.phase || (data.result !== undefined ? 'result' : 'start'),
            result: rawResult ? stripAnsi(rawResult) : undefined
          }
          this.emit('toolCall', toolPayload)
        } else if (payload.stream === 'lifecycle') {
          // lifecycle frames often arrive before the first assistant delta; capture the canonical session key early.
          this.maybeUpdateRunAndSession(payload.runId, payload.sessionKey)
          const phase = payload.data?.phase
          const state = payload.data?.state
          if (phase === 'end' || phase === 'error' || state === 'complete' || state === 'error') {
            if (this.activeStreamSource === 'agent' && this.streamStarted) {
              this.emit('streamEnd')
              this.resetStreamState()
            }
          }
        }
        break
      default:
        this.emit(event, payload)
    }
  }

  private resolveSessionKey(raw: any): string | null {
    const key =
      raw?.key ||
      raw?.sessionKey ||
      raw?.id ||
      raw?.session?.key ||
      raw?.session?.sessionKey ||
      raw?.session?.id
    return typeof key === 'string' && key.trim() ? key.trim() : null
  }

  private toIsoTimestamp(ts: unknown): string {
    if (typeof ts === 'number' && Number.isFinite(ts)) {
      const ms = ts > 1e12 ? ts : ts * 1000
      return new Date(ms).toISOString()
    }
    if (typeof ts === 'string' || ts instanceof Date) {
      const d = new Date(ts as any)
      if (!Number.isNaN(d.getTime())) return d.toISOString()
    }
    return new Date().toISOString()
  }

  // API Methods
  async listSessions(): Promise<Session[]> {
    try {
      const result = await this.call<any>('sessions.list', {
        includeDerivedTitles: true,
        includeLastMessage: true,
        limit: 50
      })
      
      const sessions = Array.isArray(result) ? result : (result?.sessions || [])
      return (Array.isArray(sessions) ? sessions : []).map((s: any) => ({
        id: s.key || s.id || `session-${Math.random()}`,
        key: s.key || s.id,
        title: s.title || s.label || s.key || s.id || 'New Chat',
        agentId: s.agentId,
        createdAt: new Date(s.updatedAt || s.createdAt || Date.now()).toISOString(),
        updatedAt: new Date(s.updatedAt || s.createdAt || Date.now()).toISOString(),
        lastMessage: s.lastMessagePreview || s.lastMessage,
        spawned: s.spawned ?? s.isSpawned ?? undefined,
        parentSessionId: s.parentSessionId || s.parentKey || undefined
      }))
    } catch {
      return []
    }
  }

  async createSession(agentId?: string): Promise<Session> {
    // In v3, sessions are created lazily on first message.
    // Generate a proper session key in the server's expected format.
    const agent = agentId || 'main'
    const uniqueId = crypto.randomUUID()
    const key = `agent:${agent}:${uniqueId}`
    return {
      id: key,
      key,
      title: 'New Chat',
      agentId: agent,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.call('sessions.delete', { key: sessionId })
  }

  async updateSession(sessionId: string, updates: { label?: string }): Promise<void> {
    await this.call('sessions.patch', { key: sessionId, ...updates })
  }

  async spawnSession(agentId: string, prompt?: string): Promise<Session> {
    const result = await this.call<any>('sessions.spawn', { agentId, prompt })
    const s = result?.session || result || {}
    const key = this.resolveSessionKey(s) || `spawned-${Date.now()}`
    return {
      id: key,
      key,
      title: s.title || s.label || key,
      agentId: s.agentId || agentId,
      createdAt: this.toIsoTimestamp(s.createdAt ?? Date.now()),
      updatedAt: this.toIsoTimestamp(s.updatedAt ?? s.createdAt ?? Date.now()),
      spawned: true,
      parentSessionId: s.parentSessionId || s.parentKey || undefined
    }
  }

  async getSessionMessages(sessionId: string): Promise<Message[]> {
    try {
      const result = await this.call<any>('chat.history', { sessionKey: sessionId })

      // Handle multiple possible response formats from the server
      let messages: any[]
      if (Array.isArray(result)) {
        messages = result
      } else if (result?.messages) {
        messages = result.messages
      } else if (result?.history) {
        messages = result.history
      } else if (result?.entries) {
        messages = result.entries
      } else if (result?.items) {
        messages = result.items
      } else {
        console.warn('[ClawControl] chat.history returned unexpected format for session', sessionId, result)
        return []
      }

      const rawMessages = messages.map((m: any) => {
          // The server already unwraps transcript lines with parsed.message,
          // so each m is { role, content, timestamp, ... } directly.
          // Fall back to nested wrappers for older formats.
          const msg = m.message || m.data || m.entry || m
          const role: string = msg.role || m.role || 'assistant'
          let rawContent = msg.content ?? msg.body ?? msg.text
          let content = ''
          let thinking = msg.thinking

          if (Array.isArray(rawContent)) {
            // Content blocks: [{ type: 'text', text: '...' }, { type: 'tool_use', ... }, ...]
            // Extract text from text/input_text blocks
            content = rawContent
              .filter((c: any) => c.type === 'text' || c.type === 'input_text' || c.type === 'output_text' || (!c.type && c.text))
              .map((c: any) => c.text)
              .filter(Boolean)
              .join('')

            // Extract thinking if present
            const thinkingBlock = rawContent.find((c: any) => c.type === 'thinking')
            if (thinkingBlock) {
              thinking = thinkingBlock.thinking
            }

            // For tool_result blocks (user-role internal protocol messages),
            // extract nested text so these entries aren't silently dropped
            if (!content) {
              content = rawContent
                .map((c: any) => {
                  if (typeof c.text === 'string') return c.text
                  // tool_result blocks can have content as string or array
                  if (c.type === 'tool_result') {
                    if (typeof c.content === 'string') return c.content
                    if (Array.isArray(c.content)) {
                      return c.content
                        .filter((b: any) => typeof b?.text === 'string')
                        .map((b: any) => b.text)
                        .join('')
                    }
                  }
                  return ''
                })
                .filter(Boolean)
                .join('')
            }
          } else if (typeof rawContent === 'object' && rawContent !== null) {
             content = rawContent.text || rawContent.content || JSON.stringify(rawContent)
          } else if (typeof rawContent === 'string') {
             content = rawContent
          } else {
             content = ''
          }

          // Aggressive heartbeat filtering (only for assistant/system messages)
          if (role === 'assistant' || role === 'system') {
            const contentUpper = content.toUpperCase()
            const isHeartbeat =
              contentUpper.includes('HEARTBEAT_OK') ||
              contentUpper.includes('READ HEARTBEAT.MD') ||
              content.includes('# HEARTBEAT - Event-Driven Status')
            if (isHeartbeat) return null
          }

          // Skip toolResult protocol messages - these are internal agent steps,
          // not user-facing chat. Tool output is shown via tool call blocks instead.
          if (role === 'toolResult') return null

          // Filter out entries without displayable text content.
          // Assistant messages with only thinking (no text) are intermediate
          // tool-calling steps that clutter the chat view.
          if (!content) return null

          return {
            id: msg.id || m.id || m.runId || `history-${Math.random()}`,
            role: role === 'user' ? 'user' : role === 'system' ? 'system' : 'assistant',
            content: stripAnsi(content),
            thinking: thinking ? stripAnsi(thinking) : thinking,
            timestamp: new Date(msg.timestamp || m.timestamp || msg.ts || m.ts || msg.createdAt || m.createdAt || Date.now()).toISOString()
          }
        }) as (Message | null)[]

        return rawMessages.filter((m): m is Message => m !== null)
    } catch (err) {
      console.warn('[ClawControl] Failed to load chat history for session', sessionId, err)
      return []
    }
  }

  // Chat
  async sendMessage(params: {
    sessionId?: string
    content: string
    agentId?: string
    thinking?: boolean
  }): Promise<{ sessionKey?: string }> {
    const idempotencyKey = crypto.randomUUID()
    const payload: Record<string, unknown> = {
      message: params.content,
      idempotencyKey
    }

    payload.sessionKey = params.sessionId || 'agent:main:main'

    if (params.thinking) {
      payload.thinking = 'normal'
    }

    const result = await this.call<any>('chat.send', payload)
    return {
      sessionKey: result?.sessionKey || result?.session?.key || result?.key
    }
  }

  // Resolve avatar URL - handles relative paths like /avatar/main
  private resolveAvatarUrl(avatar: string | undefined, agentId: string): string | undefined {
    if (!avatar) return undefined

    // Already a full URL or data URI
    if (avatar.startsWith('http://') || avatar.startsWith('https://') || avatar.startsWith('data:')) {
      return avatar
    }

    // Server-relative path like /avatar/main - convert to full URL
    if (avatar.startsWith('/avatar/')) {
      try {
        const wsUrl = new URL(this.url)
        const protocol = wsUrl.protocol === 'wss:' ? 'https:' : 'http:'
        return `${protocol}//${wsUrl.host}${avatar}`
      } catch {
        return undefined
      }
    }

    // Looks like a valid relative file path - construct avatar URL
    if (avatar.includes('/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(avatar)) {
      try {
        const wsUrl = new URL(this.url)
        const protocol = wsUrl.protocol === 'wss:' ? 'https:' : 'http:'
        return `${protocol}//${wsUrl.host}/avatar/${agentId}`
      } catch {
        return undefined
      }
    }

    // Invalid avatar (like single character from parsing error)
    return undefined
  }

  // Agents
  async listAgents(): Promise<Agent[]> {
    try {
      const result = await this.call<any>('agents.list')
      const agents = Array.isArray(result) ? result : (result?.agents || result?.items || result?.list || [])

      // Enrich each agent with identity from agent.identity.get
      const enrichedAgents: Agent[] = []
      for (const a of agents) {
        const agentId = String(a.agentId || a.id || 'main')
        let identity = a.identity || {}

        // Fetch identity if not already included
        if (!identity.name && !identity.avatar) {
          try {
            const fetchedIdentity = await this.call<any>('agent.identity.get', { agentId })
            if (fetchedIdentity) {
              identity = {
                name: fetchedIdentity.name,
                emoji: fetchedIdentity.emoji,
                avatar: fetchedIdentity.avatar,
                avatarUrl: fetchedIdentity.avatarUrl
              }
            }
          } catch {
            // Identity fetch failed, continue with defaults
          }
        }

        // Resolve avatar URL
        const avatarUrl = this.resolveAvatarUrl(identity.avatarUrl || identity.avatar, agentId)

        // Clean up emoji - filter out placeholder text
        let emoji = identity.emoji
        if (emoji && (emoji.includes('none') || emoji.includes('*') || emoji.length > 4)) {
          emoji = undefined
        }

        enrichedAgents.push({
          id: agentId,
          name: String(identity.name || a.name || agentId || 'Unnamed Agent'),
          description: a.description || identity.theme ? String(a.description || identity.theme) : undefined,
          status: a.status || 'online',
          avatar: avatarUrl,
          emoji,
          theme: identity.theme,
          model: a.model || a.config?.model || undefined,
          thinkingLevel: a.thinkingLevel || a.config?.thinkingLevel || a.thinking || undefined,
          timeout: a.timeout ?? a.config?.timeout ?? undefined,
          configured: a.configured ?? a.config?.configured ?? undefined
        })
      }

      return enrichedAgents
    } catch {
      return []
    }
  }

  // Get agent identity
  async getAgentIdentity(agentId: string): Promise<{ name?: string; emoji?: string; avatar?: string; avatarUrl?: string } | null> {
    try {
      return await this.call<any>('agent.identity.get', { agentId })
    } catch {
      return null
    }
  }

  // Get agent workspace files
  async getAgentFiles(agentId: string): Promise<{ workspace: string; files: Array<{ name: string; path: string; missing: boolean; size?: number }> } | null> {
    try {
      return await this.call<any>('agents.files.list', { agentId })
    } catch {
      return null
    }
  }

  // Get agent file content
  async getAgentFile(agentId: string, fileName: string): Promise<{ content?: string; missing: boolean } | null> {
    try {
      const result = await this.call<any>('agents.files.get', { agentId, name: fileName })
      return result?.file || null
    } catch {
      return null
    }
  }

  // Set agent file content
  async setAgentFile(agentId: string, fileName: string, content: string): Promise<boolean> {
    try {
      await this.call<any>('agents.files.set', { agentId, name: fileName, content })
      return true
    } catch {
      return false
    }
  }

  // Skills
  async listSkills(): Promise<Skill[]> {
    try {
      const result = await this.call<any>('skills.status')
      const skills = Array.isArray(result) ? result : (result?.skills || result?.items || result?.list || [])
      return skills.map((s: any) => ({
        id: String(s.skillKey || s.id || s.name || `skill-${Math.random()}`),
        name: String(s.name || 'Unnamed Skill'),
        description: String(s.description || ''),
        triggers: Array.isArray(s.triggers) ? s.triggers.map(String) : [],
        enabled: !s.disabled,
        emoji: s.emoji,
        homepage: s.homepage,
        source: s.source,
        bundled: s.bundled,
        filePath: s.filePath,
        eligible: s.eligible,
        always: s.always,
        requirements: s.requirements,
        missing: s.missing,
        install: s.install
      }))
    } catch {
      return []
    }
  }

  async toggleSkill(skillKey: string, enabled: boolean): Promise<void> {
    await this.call('skills.update', { skillKey, enabled })
  }

  async installSkill(skillName: string, installId: string): Promise<void> {
    await this.call('skills.install', { name: skillName, installId, timeoutMs: 60000 })
  }

  // Cron Jobs
  async listCronJobs(): Promise<CronJob[]> {
    try {
      const result = await this.call<any>('cron.list')
      const jobs = Array.isArray(result) ? result : (result?.cronJobs || result?.jobs || result?.cron || result?.items || result?.list || [])
      return jobs.map((c: any) => {
        // Handle complex schedule objects (e.g., { kind, expr, tz })
        let schedule = c.schedule
        if (typeof schedule === 'object' && schedule !== null) {
          schedule = schedule.expr || schedule.display || JSON.stringify(schedule)
        }

        let nextRun = c.nextRun
        if (typeof nextRun === 'object' && nextRun !== null) {
          nextRun = nextRun.display || nextRun.time || JSON.stringify(nextRun)
        }

        return {
          id: c.id || c.name || `cron-${Math.random()}`,
          name: c.name || 'Unnamed Job',
          schedule: String(schedule || 'N/A'),
          status: c.status || 'active',
          description: c.description,
          nextRun: nextRun ? String(nextRun) : undefined
        }
      })
    } catch {
      return []
    }
  }

  async toggleCronJob(cronId: string, enabled: boolean): Promise<void> {
    await this.call('cron.update', { id: cronId, status: enabled ? 'active' : 'paused' })
  }

  async getCronJobDetails(cronId: string): Promise<CronJob | null> {
    try {
      const result = await this.call<any>('cron.get', { id: cronId })
      if (!result) return null

      let schedule = result.schedule
      if (typeof schedule === 'object' && schedule !== null) {
        schedule = schedule.expr || schedule.display || JSON.stringify(schedule)
      }

      let nextRun = result.nextRun
      if (typeof nextRun === 'object' && nextRun !== null) {
        nextRun = nextRun.display || nextRun.time || JSON.stringify(nextRun)
      }

      return {
        id: result.id || result.name || cronId,
        name: result.name || 'Unnamed Job',
        schedule: String(schedule || 'N/A'),
        status: result.status || 'active',
        description: result.description,
        nextRun: nextRun ? String(nextRun) : undefined,
        content: result.content || result.markdown || result.readme || ''
      }
    } catch {
      return null
    }
  }
}
