import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { OpenClawClient } from './openclaw'

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
      expect(chunkHandler).toHaveBeenNthCalledWith(1, expect.objectContaining({ text: 'chat-1' }))
      expect(chunkHandler).toHaveBeenNthCalledWith(2, expect.objectContaining({ text: 'chat-2' }))
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
      expect(chunkHandler).toHaveBeenNthCalledWith(1, expect.objectContaining({ text: 'assistant-1' }))
      expect(chunkHandler).toHaveBeenNthCalledWith(2, expect.objectContaining({ text: 'assistant-2' }))
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
      expect(chunkHandler).toHaveBeenNthCalledWith(1, expect.objectContaining({ text: 'chat-1' }))
      expect(chunkHandler).toHaveBeenNthCalledWith(2, expect.objectContaining({ text: 'chat-2' }))
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
      expect(chunkHandler).toHaveBeenNthCalledWith(1, expect.objectContaining({ text: 'No' }))
      expect(chunkHandler).toHaveBeenNthCalledWith(2, expect.objectContaining({ text: ', I do not' }))
      expect(chunkHandler).toHaveBeenNthCalledWith(3, expect.objectContaining({ text: ' see it' }))
    })

    it('should accumulate text across content blocks on rewind', () => {
      const chunkHandler = vi.fn()
      client.on('streamChunk', chunkHandler)

      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', { runId: 'r1', stream: 'assistant', data: { text: 'Hey! Just came online. Let me' } })
      // Simulate new content block (data.text resets after tool call)
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', { runId: 'r1', stream: 'assistant', data: { text: 'get my bearings real quick.' } })

      expect(chunkHandler).toHaveBeenCalledTimes(2)
      expect(chunkHandler).toHaveBeenNthCalledWith(1, expect.objectContaining({ text: 'Hey! Just came online. Let me' }))
      // New block text is appended with separator instead of replacing
      expect(chunkHandler).toHaveBeenNthCalledWith(2, expect.objectContaining({ text: '\n\nget my bearings real quick.' }))
    })

    it('should end on assistant lifecycle complete and skip duplicate chat final streamEnd', () => {
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

      // Lifecycle end fires streamEnd + resets state. Chat final arrives after reset,
      // sees activeStreamSource is null (not 'agent'), so it processes the message
      // but streamStarted is false so no duplicate streamEnd.
      expect(streamEndHandler).toHaveBeenCalledTimes(1)
      expect(messageHandler).toHaveBeenCalledTimes(1)
    })

    it('should still process chat final message when no stream was active', () => {
      const streamEndHandler = vi.fn()
      const messageHandler = vi.fn()
      client.on('streamEnd', streamEndHandler)
      client.on('message', messageHandler)

      // @ts-expect-error - accessing private method for testing
      client.handleNotification('chat', {
        state: 'final',
        message: { id: 'msg-2', role: 'assistant', content: 'chat-only-final' }
      })

      // No stream was started, so streamEnd should not fire
      expect(streamEndHandler).toHaveBeenCalledTimes(0)
      // But the message should still be emitted
      expect(messageHandler).toHaveBeenCalledTimes(1)
      expect(messageHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-2',
          role: 'assistant',
          content: 'chat-only-final'
        })
      )
    })

    it('should emit toolCall events for tool stream', () => {
      const toolCallHandler = vi.fn()
      client.on('toolCall', toolCallHandler)

      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', {
        stream: 'tool',
        data: { toolCallId: 'tc-1', name: 'bash', phase: 'start' }
      })

      expect(toolCallHandler).toHaveBeenCalledTimes(1)
      expect(toolCallHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCallId: 'tc-1',
          name: 'bash',
          phase: 'start'
        })
      )
    })

    it('should emit toolCall with result for tool result phase', () => {
      const toolCallHandler = vi.fn()
      client.on('toolCall', toolCallHandler)

      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', {
        stream: 'tool',
        data: { toolCallId: 'tc-2', name: 'read_file', phase: 'result', result: 'file contents here' }
      })

      expect(toolCallHandler).toHaveBeenCalledTimes(1)
      expect(toolCallHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCallId: 'tc-2',
          name: 'read_file',
          phase: 'result',
          result: 'file contents here'
        })
      )
    })

    it('should trigger streamStart on tool event if no stream started yet', () => {
      const streamStartHandler = vi.fn()
      client.on('streamStart', streamStartHandler)

      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', {
        stream: 'tool',
        data: { toolCallId: 'tc-3', name: 'bash', phase: 'start' }
      })

      expect(streamStartHandler).toHaveBeenCalledTimes(1)
    })

    it('should not interfere with assistant stream source when tool events arrive', () => {
      const chunkHandler = vi.fn()
      const toolCallHandler = vi.fn()
      client.on('streamChunk', chunkHandler)
      client.on('toolCall', toolCallHandler)

      // Agent assistant claims the stream first
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', { stream: 'assistant', data: { delta: 'hello' } })
      // Tool event arrives mid-stream
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', { stream: 'tool', data: { toolCallId: 'tc-4', name: 'bash', phase: 'start' } })
      // More assistant text
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', { stream: 'assistant', data: { delta: 'hello world' } })

      // Tool event should still be emitted
      expect(toolCallHandler).toHaveBeenCalledTimes(1)
      // Assistant stream should not be disrupted
      expect(chunkHandler).toHaveBeenCalledTimes(2)
      expect(chunkHandler).toHaveBeenNthCalledWith(1, expect.objectContaining({ text: 'hello' }))
      expect(chunkHandler).toHaveBeenNthCalledWith(2, expect.objectContaining({ text: ' world' }))
    })

    it('should include sessionKey in streamChunk payloads', () => {
      const chunkHandler = vi.fn()
      client.on('streamChunk', chunkHandler)

      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', {
        stream: 'assistant',
        sessionKey: 'sess-1',
        data: { delta: 'hello' }
      })

      expect(chunkHandler).toHaveBeenCalledTimes(1)
      expect(chunkHandler).toHaveBeenCalledWith({ text: 'hello', sessionKey: 'sess-1' })
    })
  })

  describe('primary session filtering', () => {
    it('should ignore events from non-primary sessions', () => {
      const chunkHandler = vi.fn()
      client.on('streamChunk', chunkHandler)

      // Set primary session
      client.setPrimarySessionKey('primary-session')

      // Event from primary session should be processed
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', {
        stream: 'assistant',
        sessionKey: 'primary-session',
        data: { delta: 'primary text' }
      })

      // Event from non-primary session should be ignored
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', {
        stream: 'assistant',
        sessionKey: 'subagent-session',
        data: { delta: 'subagent text' }
      })

      expect(chunkHandler).toHaveBeenCalledTimes(1)
      expect(chunkHandler).toHaveBeenCalledWith(expect.objectContaining({ text: 'primary text' }))
    })

    it('should allow events without sessionKey to pass through (legacy fallback)', () => {
      const chunkHandler = vi.fn()
      client.on('streamChunk', chunkHandler)

      client.setPrimarySessionKey('primary-session')

      // Event with no sessionKey should still be processed
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', {
        stream: 'assistant',
        data: { delta: 'legacy event' }
      })

      expect(chunkHandler).toHaveBeenCalledTimes(1)
      expect(chunkHandler).toHaveBeenCalledWith(expect.objectContaining({ text: 'legacy event' }))
    })

    it('should process all events when no primary session is set', () => {
      const chunkHandler = vi.fn()
      client.on('streamChunk', chunkHandler)

      // No primary session set — all events should pass through
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', {
        stream: 'assistant',
        sessionKey: 'any-session',
        data: { delta: 'some text' }
      })

      expect(chunkHandler).toHaveBeenCalledTimes(1)
    })

    it('should not reset stream state when subagent runId differs', () => {
      const chunkHandler = vi.fn()
      client.on('streamChunk', chunkHandler)

      client.setPrimarySessionKey('primary-session')

      // Parent session sends text
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', {
        stream: 'assistant',
        sessionKey: 'primary-session',
        runId: 'parent-run',
        data: { delta: 'hello from parent' }
      })

      // Subagent event with different runId should be filtered out entirely
      // (not cause a stream reset)
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', {
        stream: 'assistant',
        sessionKey: 'subagent-session',
        runId: 'subagent-run',
        data: { delta: 'hello from subagent' }
      })

      // Parent continues — should still work without reset
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', {
        stream: 'assistant',
        sessionKey: 'primary-session',
        runId: 'parent-run',
        data: { delta: 'hello from parent, continued' }
      })

      expect(chunkHandler).toHaveBeenCalledTimes(2)
      expect(chunkHandler).toHaveBeenNthCalledWith(1, expect.objectContaining({ text: 'hello from parent' }))
      expect(chunkHandler).toHaveBeenNthCalledWith(2, expect.objectContaining({ text: ', continued' }))
    })

    it('should filter tool events from non-primary sessions', () => {
      const toolCallHandler = vi.fn()
      client.on('toolCall', toolCallHandler)

      client.setPrimarySessionKey('primary-session')

      // Tool event from subagent should be ignored
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', {
        stream: 'tool',
        sessionKey: 'subagent-session',
        data: { toolCallId: 'tc-sub', name: 'bash', phase: 'start' }
      })

      // Tool event from primary session should be processed
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', {
        stream: 'tool',
        sessionKey: 'primary-session',
        data: { toolCallId: 'tc-primary', name: 'bash', phase: 'start' }
      })

      expect(toolCallHandler).toHaveBeenCalledTimes(1)
      expect(toolCallHandler).toHaveBeenCalledWith(
        expect.objectContaining({ toolCallId: 'tc-primary' })
      )
    })

    it('should filter chat events from non-primary sessions', () => {
      const chunkHandler = vi.fn()
      client.on('streamChunk', chunkHandler)

      client.setPrimarySessionKey('primary-session')

      // Chat delta from subagent should be ignored
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('chat', {
        state: 'delta',
        sessionKey: 'subagent-session',
        delta: 'subagent chat'
      })

      // Chat delta from primary session should be processed
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('chat', {
        state: 'delta',
        sessionKey: 'primary-session',
        delta: 'primary chat'
      })

      expect(chunkHandler).toHaveBeenCalledTimes(1)
      expect(chunkHandler).toHaveBeenCalledWith(expect.objectContaining({ text: 'primary chat' }))
    })

    it('setPrimarySessionKey pre-seeding works before events arrive', () => {
      const chunkHandler = vi.fn()
      const streamStartHandler = vi.fn()
      client.on('streamChunk', chunkHandler)
      client.on('streamStart', streamStartHandler)

      // Pre-seed before any events
      client.setPrimarySessionKey('my-session')

      // Only my-session events should create a stream
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', {
        stream: 'assistant',
        sessionKey: 'other-session',
        data: { delta: 'should be ignored' }
      })
      // @ts-expect-error - accessing private method for testing
      client.handleNotification('agent', {
        stream: 'assistant',
        sessionKey: 'my-session',
        data: { delta: 'should be shown' }
      })

      expect(streamStartHandler).toHaveBeenCalledTimes(1)
      expect(chunkHandler).toHaveBeenCalledTimes(1)
      expect(chunkHandler).toHaveBeenCalledWith(expect.objectContaining({ text: 'should be shown' }))
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

    it('should use default sessionKey when sessionId is not provided', async () => {
      const callSpy = vi
        .spyOn(client as any, 'call')
        .mockResolvedValue({ sessionKey: 'server-session-2' })

      await client.sendMessage({
        content: 'new chat'
      })

      expect(callSpy).toHaveBeenCalledTimes(1)
      const payload = callSpy.mock.calls[0][1]
      // chat.ts always sends a sessionKey, defaulting to 'agent:main:main'
      expect(payload).toHaveProperty('sessionKey', 'agent:main:main')
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
