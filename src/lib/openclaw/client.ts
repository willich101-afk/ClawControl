// OpenClaw Client - Core Connection, Events, and Streaming

import type {
  Message, Session, Agent, Skill, CronJob,
  RequestFrame, ResponseFrame, EventFrame, EventHandler
} from './types'
import { stripAnsi, extractToolResultText, extractTextFromContent, isHeartbeatContent } from './utils'
import * as sessionsApi from './sessions'
import * as chatApi from './chat'
import * as agentsApi from './agents'
import * as skillsApi from './skills'
import * as cronApi from './cron-jobs'

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
  private primarySessionKey: string | null = null
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

  // Stream state management

  private resetStreamState(): void {
    this.activeStreamSource = null
    this.assistantStreamText = ''
    this.assistantStreamMode = null
    this.currentBlockOffset = 0
    this.streamStarted = false
    this.activeRunId = null
    this.activeSessionKey = null
    this.primarySessionKey = null
  }

  private maybeUpdateRunAndSession(runId?: unknown, sessionKey?: unknown): void {
    // No longer reset on runId mismatch — primary session gate filters subagent events.
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
      this.emit('streamStart', { sessionKey: this.activeSessionKey })
    }
  }

  private applyStreamText(nextText: string): void {
    if (!nextText) return

    const previous = this.assistantStreamText
    if (nextText === previous) return

    const sk = this.activeSessionKey

    if (!previous) {
      this.assistantStreamText = nextText
      this.emit('streamChunk', { text: nextText, sessionKey: sk })
      return
    }

    if (nextText.startsWith(previous)) {
      const append = nextText.slice(previous.length)
      this.assistantStreamText = nextText
      if (append) {
        this.emit('streamChunk', { text: append, sessionKey: sk })
      }
      return
    }

    // New content block — accumulate rather than replace.
    const separator = '\n\n'
    this.assistantStreamText = this.assistantStreamText + separator + nextText
    this.emit('streamChunk', { text: separator + nextText, sessionKey: sk })
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

  // Notification / event handling

  private handleNotification(event: string, payload: any): void {
    if (event === 'agent' && payload.stream === 'assistant') {
      console.log('[ClawControl] handleNotification agent:assistant clientId:', this._debugId, 'activeStreamSource:', this.activeStreamSource)
    }

    const eventSessionKey = payload?.sessionKey as string | undefined

    // When a primary session filter is active and an event arrives from a
    // different session, that's direct evidence of a subagent. Emit a
    // detection event so the store can show a subagent block without
    // relying on polling.
    if (this.primarySessionKey && eventSessionKey && eventSessionKey !== this.primarySessionKey) {
      this.emit('subagentDetected', { sessionKey: eventSessionKey })
    }

    switch (event) {
      case 'chat':
        if (!this.shouldProcessEvent(eventSessionKey)) return

        if (payload.state === 'delta') {
          this.maybeUpdateRunAndSession(payload.runId, eventSessionKey)
          this.ensureStream('chat', 'cumulative', payload.runId)
          if (this.activeStreamSource !== 'chat') {
            // Another stream type already claimed this response.
            return
          }

          const rawText = payload.message?.content !== undefined
            ? extractTextFromContent(payload.message.content)
            : (typeof payload.delta === 'string' ? stripAnsi(payload.delta) : '')

          if (rawText && !isHeartbeatContent(rawText)) {
            const nextText = this.mergeIncoming(rawText, 'cumulative')
            this.applyStreamText(nextText)
          }
          return
        } else if (payload.state === 'final') {
          this.maybeUpdateRunAndSession(payload.runId, eventSessionKey)

          // If the agent stream handled this response, lifecycle:end already
          // emitted streamEnd and reset state. Skip to avoid duplicates.
          if (this.activeStreamSource === 'agent') {
            return
          }

          if (payload.message) {
            const text = extractTextFromContent(payload.message.content)
            if (text && !isHeartbeatContent(text)) {
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
                timestamp: new Date(tsMs).toISOString(),
                sessionKey: eventSessionKey
              })
            }
          }

          if (this.streamStarted) {
            this.emit('streamEnd', { sessionKey: eventSessionKey })
          }
          this.resetStreamState()
        }
        break
      case 'presence':
        this.emit('agentStatus', payload)
        break
      case 'agent':
        if (!this.shouldProcessEvent(eventSessionKey)) return

        if (payload.stream === 'assistant') {
          this.maybeUpdateRunAndSession(payload.runId, eventSessionKey)
          const hasCanonicalText = typeof payload.data?.text === 'string'
          this.ensureStream('agent', hasCanonicalText ? 'cumulative' : 'delta', payload.runId)
          if (this.activeStreamSource !== 'agent') {
            // Another stream type already claimed this response.
            return
          }

          // Prefer canonical cumulative text when available. Delta fields can be inconsistent.
          const canonicalText = typeof payload.data?.text === 'string' ? stripAnsi(payload.data.text) : ''
          if (canonicalText && !isHeartbeatContent(canonicalText)) {
            const nextText = this.mergeIncoming(canonicalText, 'cumulative')
            this.applyStreamText(nextText)
            return
          }

          const deltaText = typeof payload.data?.delta === 'string' ? stripAnsi(payload.data.delta) : ''
          if (deltaText && !isHeartbeatContent(deltaText)) {
            const nextText = this.mergeIncoming(deltaText, 'delta')
            this.applyStreamText(nextText)
          }
        } else if (payload.stream === 'tool') {
          this.maybeUpdateRunAndSession(payload.runId, eventSessionKey)

          if (!this.streamStarted) {
            this.streamStarted = true
            this.emit('streamStart', { sessionKey: eventSessionKey })
          }

          const data = payload.data || {}
          const rawResult = extractToolResultText(data.result)
          const toolPayload = {
            toolCallId: data.toolCallId || data.id || `tool-${Date.now()}`,
            name: data.name || data.toolName || 'unknown',
            phase: data.phase || (data.result !== undefined ? 'result' : 'start'),
            result: rawResult ? stripAnsi(rawResult) : undefined,
            sessionKey: eventSessionKey
          }
          this.emit('toolCall', toolPayload)
        } else if (payload.stream === 'lifecycle') {
          // lifecycle frames often arrive before the first assistant delta; capture the canonical session key early.
          this.maybeUpdateRunAndSession(payload.runId, eventSessionKey)
          const phase = payload.data?.phase
          const state = payload.data?.state
          if (phase === 'end' || phase === 'error' || state === 'complete' || state === 'error') {
            if (this.activeStreamSource === 'agent' && this.streamStarted) {
              this.emit('streamEnd', { sessionKey: eventSessionKey })
              this.resetStreamState()
            }
          }
        }
        break
      default:
        this.emit(event, payload)
    }
  }

  getActiveSessionKey(): string | null {
    return this.activeSessionKey
  }

  setPrimarySessionKey(key: string | null): void {
    this.primarySessionKey = key
  }

  private shouldProcessEvent(sessionKey?: unknown): boolean {
    if (!this.primarySessionKey) return true
    if (!sessionKey || typeof sessionKey !== 'string') return true
    return sessionKey === this.primarySessionKey
  }

  // Domain API methods - delegated to modules

  // Sessions
  async listSessions(): Promise<Session[]> {
    return sessionsApi.listSessions(this.call.bind(this))
  }

  async createSession(agentId?: string): Promise<Session> {
    return sessionsApi.createSession(agentId)
  }

  async deleteSession(sessionId: string): Promise<void> {
    return sessionsApi.deleteSession(this.call.bind(this), sessionId)
  }

  async updateSession(sessionId: string, updates: { label?: string }): Promise<void> {
    return sessionsApi.updateSession(this.call.bind(this), sessionId, updates)
  }

  async spawnSession(agentId: string, prompt?: string): Promise<Session> {
    return sessionsApi.spawnSession(this.call.bind(this), agentId, prompt)
  }

  // Chat
  async getSessionMessages(sessionId: string): Promise<Message[]> {
    return chatApi.getSessionMessages(this.call.bind(this), sessionId)
  }

  async sendMessage(params: {
    sessionId?: string
    content: string
    agentId?: string
    thinking?: boolean
  }): Promise<{ sessionKey?: string }> {
    return chatApi.sendMessage(this.call.bind(this), params)
  }

  // Agents
  async listAgents(): Promise<Agent[]> {
    return agentsApi.listAgents(this.call.bind(this), this.url)
  }

  async getAgentIdentity(agentId: string): Promise<{ name?: string; emoji?: string; avatar?: string; avatarUrl?: string } | null> {
    return agentsApi.getAgentIdentity(this.call.bind(this), agentId)
  }

  async getAgentFiles(agentId: string): Promise<{ workspace: string; files: Array<{ name: string; path: string; missing: boolean; size?: number }> } | null> {
    return agentsApi.getAgentFiles(this.call.bind(this), agentId)
  }

  async getAgentFile(agentId: string, fileName: string): Promise<{ content?: string; missing: boolean } | null> {
    return agentsApi.getAgentFile(this.call.bind(this), agentId, fileName)
  }

  async setAgentFile(agentId: string, fileName: string, content: string): Promise<boolean> {
    return agentsApi.setAgentFile(this.call.bind(this), agentId, fileName, content)
  }

  // Skills
  async listSkills(): Promise<Skill[]> {
    return skillsApi.listSkills(this.call.bind(this))
  }

  async toggleSkill(skillKey: string, enabled: boolean): Promise<void> {
    return skillsApi.toggleSkill(this.call.bind(this), skillKey, enabled)
  }

  async installSkill(skillName: string, installId: string): Promise<void> {
    return skillsApi.installSkill(this.call.bind(this), skillName, installId)
  }

  // Cron Jobs
  async listCronJobs(): Promise<CronJob[]> {
    return cronApi.listCronJobs(this.call.bind(this))
  }

  async toggleCronJob(cronId: string, enabled: boolean): Promise<void> {
    return cronApi.toggleCronJob(this.call.bind(this), cronId, enabled)
  }

  async getCronJobDetails(cronId: string): Promise<CronJob | null> {
    return cronApi.getCronJobDetails(this.call.bind(this), cronId)
  }
}
