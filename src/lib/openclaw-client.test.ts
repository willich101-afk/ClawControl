import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { OpenClawClient } from './openclaw-client'

describe('OpenClawClient', () => {
  let client: OpenClawClient

  beforeEach(() => {
    client = new OpenClawClient('ws://localhost:18789')
  })

  afterEach(() => {
    client.disconnect()
  })

  describe('constructor', () => {
    it('should create a client with the given URL', () => {
      expect(client).toBeDefined()
    })
  })

  describe('connect', () => {
    it('should connect to the WebSocket server', async () => {
      const connectedHandler = vi.fn()
      client.on('connected', connectedHandler)

      await client.connect()

      expect(connectedHandler).toHaveBeenCalled()
    })
  })

  describe('event handling', () => {
    it('should register and emit events', () => {
      const handler = vi.fn()
      client.on('test', handler)

      // @ts-expect-error - accessing private method for testing
      client.emit('test', 'data')

      expect(handler).toHaveBeenCalledWith('data')
    })

    it('should unregister events', () => {
      const handler = vi.fn()
      client.on('test', handler)
      client.off('test', handler)

      // @ts-expect-error - accessing private method for testing
      client.emit('test', 'data')

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('stream handling', () => {
    it('should stream chat deltas when chat stream is active', () => {
      const chunkHandler = vi.fn()
      client.on('streamChunk', chunkHandler)

      // @ts-expect-error - accessing private method for testing
      client.handleNotification('chat', { state: 'delta', delta: 'chat-1' })
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('chat', { state: 'delta', delta: 'chat-1chat-2' })

      expect(chunkHandler).toHaveBeenCalledTimes(2)
      expect(chunkHandler).toHaveBeenNthCalledWith(1, 'chat-1')
      expect(chunkHandler).toHaveBeenNthCalledWith(2, 'chat-2')
    })

    it('should ignore chat deltas when agent stream claims first', () => {
      const chunkHandler = vi.fn()
      client.on('streamChunk', chunkHandler)

      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', { stream: 'assistant', data: { delta: 'assistant-1' } })
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('chat', { state: 'delta', delta: 'chat-1' })
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', { stream: 'assistant', data: { delta: 'assistant-2' } })

      expect(chunkHandler).toHaveBeenCalledTimes(2)
      expect(chunkHandler).toHaveBeenNthCalledWith(1, 'assistant-1')
      expect(chunkHandler).toHaveBeenNthCalledWith(2, 'assistant-2')
    })

    it('should ignore agent deltas when chat stream claims first', () => {
      const chunkHandler = vi.fn()
      client.on('streamChunk', chunkHandler)

      // @ts-expect-error - accessing private method for testing
      client.handleNotification('chat', { state: 'delta', delta: 'chat-1' })
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', { stream: 'assistant', data: { delta: 'assistant-1' } })
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('chat', { state: 'delta', delta: 'chat-1chat-2' })

      expect(chunkHandler).toHaveBeenCalledTimes(2)
      expect(chunkHandler).toHaveBeenNthCalledWith(1, 'chat-1')
      expect(chunkHandler).toHaveBeenNthCalledWith(2, 'chat-2')
    })

    it('should de-duplicate cumulative assistant chunks', () => {
      const chunkHandler = vi.fn()
      client.on('streamChunk', chunkHandler)

      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', { stream: 'assistant', data: { delta: 'No' } })
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', { stream: 'assistant', data: { delta: 'No, I do not' } })
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', { stream: 'assistant', data: { delta: 'No, I do not' } })
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', { stream: 'assistant', data: { delta: 'No, I do not see it' } })

      expect(chunkHandler).toHaveBeenCalledTimes(3)
      expect(chunkHandler).toHaveBeenNthCalledWith(1, 'No')
      expect(chunkHandler).toHaveBeenNthCalledWith(2, ', I do not')
      expect(chunkHandler).toHaveBeenNthCalledWith(3, ' see it')
    })

    it('should replace stream content on rewind/rewrite', () => {
      const chunkHandler = vi.fn()
      client.on('streamChunk', chunkHandler)

      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', { runId: 'r1', stream: 'assistant', data: { text: 'Hey! Just came online. Let me' } })
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', { runId: 'r1', stream: 'assistant', data: { text: 'get my bearings real quick.' } })

      expect(chunkHandler).toHaveBeenCalledTimes(2)
      expect(chunkHandler).toHaveBeenNthCalledWith(1, 'Hey! Just came online. Let me')
      expect(chunkHandler).toHaveBeenNthCalledWith(2, { kind: 'replace', text: 'get my bearings real quick.' })
    })

    it('should end on assistant lifecycle complete and still process chat final', () => {
      const streamEndHandler = vi.fn()
      const messageHandler = vi.fn()
      client.on('streamEnd', streamEndHandler)
      client.on('message', messageHandler)

      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', { stream: 'assistant', data: { delta: 'assistant-1' } })
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', { stream: 'lifecycle', data: { state: 'complete' } })
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('chat', {
        state: 'final',
        message: { id: 'msg-1', role: 'assistant', content: 'duplicate-final' }
      })

      // Lifecycle end + chat final can both arrive; chat final is still useful for canonical IDs.
      expect(streamEndHandler).toHaveBeenCalledTimes(2)
      expect(messageHandler).toHaveBeenCalledTimes(1)
    })

    it('should still process chat final when assistant stream is not active', () => {
      const streamEndHandler = vi.fn()
      const messageHandler = vi.fn()
      client.on('streamEnd', streamEndHandler)
      client.on('message', messageHandler)

      // @ts-expect-error - accessing private method for testing
      client.handleNotification('chat', {
        state: 'final',
        message: { id: 'msg-2', role: 'assistant', content: 'chat-only-final' }
      })

      expect(streamEndHandler).toHaveBeenCalledTimes(1)
      expect(messageHandler).toHaveBeenCalledTimes(1)
      expect(messageHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-2',
          role: 'assistant',
          content: 'chat-only-final'
        })
      )
    })
  })

  describe('listSessions', () => {
    it('should return sessions after connecting', async () => {
      await client.connect()
      const sessions = await client.listSessions()

      expect(Array.isArray(sessions)).toBe(true)
      expect(sessions.length).toBeGreaterThan(0)
      expect(sessions[0]).toHaveProperty('id')
      expect(sessions[0]).toHaveProperty('title')
      expect(sessions[0].id).toBe(sessions[0].key)
    })
  })

  describe('listAgents', () => {
    it('should return agents after connecting', async () => {
      await client.connect()
      const agents = await client.listAgents()

      expect(Array.isArray(agents)).toBe(true)
      expect(agents.length).toBeGreaterThan(0)
      expect(agents[0]).toHaveProperty('id')
      expect(agents[0]).toHaveProperty('name')
      expect(agents[0]).toHaveProperty('status')
    })
  })

  describe('listSkills', () => {
    it('should return skills after connecting', async () => {
      await client.connect()
      const skills = await client.listSkills()

      expect(Array.isArray(skills)).toBe(true)
      expect(skills.length).toBeGreaterThan(0)
      expect(skills[0]).toHaveProperty('id')
      expect(skills[0]).toHaveProperty('name')
      expect(skills[0]).toHaveProperty('triggers')
    })
  })

  describe('listCronJobs', () => {
    it('should return cron jobs after connecting', async () => {
      await client.connect()
      const cronJobs = await client.listCronJobs()

      expect(Array.isArray(cronJobs)).toBe(true)
      expect(cronJobs.length).toBeGreaterThan(0)
      expect(cronJobs[0]).toHaveProperty('id')
      expect(cronJobs[0]).toHaveProperty('name')
      expect(cronJobs[0]).toHaveProperty('schedule')
      expect(cronJobs[0]).toHaveProperty('status')
    })
  })

  describe('createSession', () => {
    it('should create a new session', async () => {
      const session = await client.createSession()

      expect(session).toHaveProperty('id')
      expect(session).toHaveProperty('title')
      expect(session.title).toBe('New Chat')
    })

    it('should create a session with an agent', async () => {
      const session = await client.createSession('claude')

      expect(session).toHaveProperty('agentId')
      expect(session.agentId).toBe('claude')
    })
  })

  describe('sendMessage', () => {
    it('should include sessionKey when sessionId is provided', async () => {
      const callSpy = vi
        .spyOn(client as any, 'call')
        .mockResolvedValue({ sessionKey: 'server-session-1' })

      await client.sendMessage({
        sessionId: 'session-123',
        content: 'hello'
      })

      expect(callSpy).toHaveBeenCalledTimes(1)
      const payload = callSpy.mock.calls[0][1]
      expect(payload).toHaveProperty('sessionKey', 'session-123')
      expect(payload).toHaveProperty('message', 'hello')
    })

    it('should omit sessionKey when sessionId is not provided', async () => {
      const callSpy = vi
        .spyOn(client as any, 'call')
        .mockResolvedValue({ sessionKey: 'server-session-2' })

      await client.sendMessage({
        content: 'new chat'
      })

      expect(callSpy).toHaveBeenCalledTimes(1)
      const payload = callSpy.mock.calls[0][1]
      expect(payload).not.toHaveProperty('sessionKey')
      expect(payload).toHaveProperty('message', 'new chat')
    })
  })

  describe('disconnect', () => {
    it('should close the WebSocket connection', async () => {
      await client.connect()
      client.disconnect()

      // Should not throw
      expect(true).toBe(true)
    })
  })
})
