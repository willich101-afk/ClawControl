import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { OpenClawClient, Message, Session, Agent, Skill, CronJob, AgentFile } from '../lib/openclaw-client'
import * as Platform from '../lib/platform'

export interface ToolCall {
  toolCallId: string
  name: string
  phase: 'start' | 'result'
  result?: string
  startedAt: number
}

interface AgentDetail {
  agent: Agent
  workspace: string
  files: AgentFile[]
}

interface AppState {
  // Theme
  theme: 'dark' | 'light'
  setTheme: (theme: 'dark' | 'light') => void
  toggleTheme: () => void

  // Connection
  serverUrl: string
  setServerUrl: (url: string) => void
  authMode: 'token' | 'password'
  setAuthMode: (mode: 'token' | 'password') => void
  gatewayToken: string
  setGatewayToken: (token: string) => void
  connected: boolean
  connecting: boolean
  client: OpenClawClient | null

  // Settings Modal
  showSettings: boolean
  setShowSettings: (show: boolean) => void

  // Certificate Error Modal
  showCertError: boolean
  certErrorUrl: string | null
  showCertErrorModal: (httpsUrl: string) => void
  hideCertErrorModal: () => void

  // UI State
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  rightPanelOpen: boolean
  setRightPanelOpen: (open: boolean) => void
  rightPanelTab: 'skills' | 'crons'
  setRightPanelTab: (tab: 'skills' | 'crons') => void

  // Main View State
  mainView: 'chat' | 'skill-detail' | 'cron-detail' | 'agent-detail'
  setMainView: (view: 'chat' | 'skill-detail' | 'cron-detail' | 'agent-detail') => void
  selectedSkill: Skill | null
  selectedCronJob: CronJob | null
  selectedAgentDetail: AgentDetail | null
  selectSkill: (skill: Skill) => Promise<void>
  selectCronJob: (cronJob: CronJob) => Promise<void>
  selectAgentForDetail: (agent: Agent) => Promise<void>
  closeDetailView: () => void
  toggleSkillEnabled: (skillId: string, enabled: boolean) => Promise<void>
  saveAgentFile: (agentId: string, fileName: string, content: string) => Promise<boolean>
  refreshAgentFiles: (agentId: string) => Promise<void>

  // Chat
  messages: Message[]
  addMessage: (message: Message) => void
  clearMessages: () => void
  isStreaming: boolean
  setIsStreaming: (streaming: boolean) => void
  hadStreamChunks: boolean
  activeToolCalls: ToolCall[]
  thinkingEnabled: boolean
  setThinkingEnabled: (enabled: boolean) => void

  // Notifications & Unread
  notificationsEnabled: boolean
  setNotificationsEnabled: (enabled: boolean) => Promise<void>
  unreadCounts: Record<string, number>
  clearUnread: (sessionId: string) => void
  streamingSessionId: string | null

  // Sessions
  sessions: Session[]
  currentSessionId: string | null
  setCurrentSession: (sessionId: string) => void
  createNewSession: () => Promise<void>
  deleteSession: (sessionId: string) => void
  updateSessionLabel: (sessionId: string, label: string) => Promise<void>
  spawnSubagentSession: (agentId: string, prompt?: string) => Promise<void>

  // Agents
  agents: Agent[]
  currentAgentId: string | null
  setCurrentAgent: (agentId: string) => void

  // Skills & Crons
  skills: Skill[]
  cronJobs: CronJob[]

  // Actions
  initializeApp: () => Promise<void>
  connect: () => Promise<void>
  disconnect: () => void
  sendMessage: (content: string) => Promise<void>
  fetchSessions: () => Promise<void>
  fetchAgents: () => Promise<void>
  fetchSkills: () => Promise<void>
  fetchCronJobs: () => Promise<void>
}

function shouldNotify(
  notificationsEnabled: boolean,
  msgSessionId: string | null,
  currentSessionId: string | null
): boolean {
  if (!notificationsEnabled) return false
  if (Platform.isAppActive() && msgSessionId === currentSessionId) return false
  return true
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Theme
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),

      // Connection
      serverUrl: '',
      setServerUrl: (url) => set({ serverUrl: url }),
      authMode: 'token',
      setAuthMode: (mode) => set({ authMode: mode }),
      gatewayToken: '',
      setGatewayToken: (token) => {
        set({ gatewayToken: token })
        Platform.saveToken(token).catch(() => {})
      },
      connected: false,
      connecting: false,
      client: null,

      // Settings Modal
      showSettings: false,
      setShowSettings: (show) => set({ showSettings: show }),

      // Certificate Error Modal
      showCertError: false,
      certErrorUrl: null,
      showCertErrorModal: (httpsUrl) => set({ showCertError: true, certErrorUrl: httpsUrl }),
      hideCertErrorModal: () => set({ showCertError: false, certErrorUrl: null }),

      // UI State
      sidebarOpen: false,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      sidebarCollapsed: false,
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      rightPanelOpen: true,
      setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
      rightPanelTab: 'skills',
      setRightPanelTab: (tab) => set({ rightPanelTab: tab }),

      // Main View State
      mainView: 'chat',
      setMainView: (view) => set({ mainView: view }),
      selectedSkill: null,
      selectedCronJob: null,
      selectedAgentDetail: null,
      selectSkill: async (skill) => {
        // All skill data comes from skills.status, no need for separate fetch
        set({ mainView: 'skill-detail', selectedSkill: skill, selectedCronJob: null, selectedAgentDetail: null })
      },
      selectCronJob: async (cronJob) => {
        const { client } = get()
        set({ mainView: 'cron-detail', selectedCronJob: cronJob, selectedSkill: null, selectedAgentDetail: null })

        // Fetch full cron job details including content
        if (client) {
          const details = await client.getCronJobDetails(cronJob.id)
          if (details) {
            set({ selectedCronJob: details })
          }
        }
      },
      selectAgentForDetail: async (agent) => {
        const { client } = get()
        set({ mainView: 'agent-detail', selectedAgentDetail: { agent, workspace: '', files: [] }, selectedSkill: null, selectedCronJob: null })

        if (client) {
          // Fetch workspace files
          const filesResult = await client.getAgentFiles(agent.id)
          if (filesResult) {
            // Fetch content for each file
            const filesWithContent: AgentFile[] = []
            for (const file of filesResult.files) {
              if (!file.missing) {
                const fileContent = await client.getAgentFile(agent.id, file.name)
                filesWithContent.push({
                  ...file,
                  content: fileContent?.content
                })
              } else {
                filesWithContent.push(file)
              }
            }
            set({
              selectedAgentDetail: {
                agent,
                workspace: filesResult.workspace,
                files: filesWithContent
              }
            })
          }
        }
      },
      closeDetailView: () => set({ mainView: 'chat', selectedSkill: null, selectedCronJob: null, selectedAgentDetail: null }),
      toggleSkillEnabled: async (skillId, enabled) => {
        const { client } = get()
        if (!client) return

        await client.toggleSkill(skillId, enabled)

        // Update local state
        set((state) => ({
          skills: state.skills.map((s) =>
            s.id === skillId ? { ...s, enabled } : s
          ),
          selectedSkill: state.selectedSkill?.id === skillId
            ? { ...state.selectedSkill, enabled }
            : state.selectedSkill
        }))
      },
      saveAgentFile: async (agentId, fileName, content) => {
        const { client } = get()
        if (!client) return false

        const success = await client.setAgentFile(agentId, fileName, content)
        if (success) {
          // Update local state
          set((state) => {
            if (!state.selectedAgentDetail) return state
            return {
              selectedAgentDetail: {
                ...state.selectedAgentDetail,
                files: state.selectedAgentDetail.files.map((f) =>
                  f.name === fileName ? { ...f, content, missing: false } : f
                )
              }
            }
          })

          // Refresh agents list to update identity
          await get().fetchAgents()
        }
        return success
      },
      refreshAgentFiles: async (agentId) => {
        const { client, selectedAgentDetail } = get()
        if (!client || !selectedAgentDetail) return

        const filesResult = await client.getAgentFiles(agentId)
        if (filesResult) {
          const filesWithContent: AgentFile[] = []
          for (const file of filesResult.files) {
            if (!file.missing) {
              const fileContent = await client.getAgentFile(agentId, file.name)
              filesWithContent.push({
                ...file,
                content: fileContent?.content
              })
            } else {
              filesWithContent.push(file)
            }
          }
          set({
            selectedAgentDetail: {
              ...selectedAgentDetail,
              workspace: filesResult.workspace,
              files: filesWithContent
            }
          })
        }
      },

      // Chat
      messages: [],
      addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
      clearMessages: () => set({ messages: [] }),
      isStreaming: false,
      setIsStreaming: (streaming) => set({ isStreaming: streaming }),
      hadStreamChunks: false,
      activeToolCalls: [],
      thinkingEnabled: false,
      setThinkingEnabled: (enabled) => set({ thinkingEnabled: enabled }),

      // Notifications & Unread
      notificationsEnabled: false,
      setNotificationsEnabled: async (enabled) => {
        if (enabled) {
          const granted = await Platform.requestNotificationPermission()
          if (!granted) return
        }
        set({ notificationsEnabled: enabled })
      },
      unreadCounts: {},
      clearUnread: (sessionId) => set((state) => {
        const { [sessionId]: _, ...rest } = state.unreadCounts
        return { unreadCounts: rest }
      }),
      streamingSessionId: null,

      // Sessions
      sessions: [],
      currentSessionId: null,
      setCurrentSession: (sessionId) => {
        const { unreadCounts } = get()
        const { [sessionId]: _, ...restCounts } = unreadCounts
        set({ currentSessionId: sessionId, messages: [], unreadCounts: restCounts })
        // Load session messages
        get().client?.getSessionMessages(sessionId).then((messages) => {
          set({ messages })
        })
      },
      createNewSession: async () => {
        const { client, currentAgentId } = get()
        if (!client) return

        const session = await client.createSession(currentAgentId || undefined)
        const sessionId = session.key || session.id
        set((state) => ({
          sessions: [session, ...state.sessions],
          currentSessionId: sessionId,
          messages: [],
          isStreaming: false,
          hadStreamChunks: false,
          streamingSessionId: null
        }))
      },
      deleteSession: (sessionId) => {
        const { client } = get()
        client?.deleteSession(sessionId)
        set((state) => ({
          sessions: state.sessions.filter((s) => (s.key || s.id) !== sessionId),
          currentSessionId: state.currentSessionId === sessionId ? null : state.currentSessionId
        }))
      },
      updateSessionLabel: async (sessionId, label) => {
        const { client } = get()
        if (!client) return

        await client.updateSession(sessionId, { label })
        set((state) => ({
          sessions: state.sessions.map((s) =>
            (s.key || s.id) === sessionId ? { ...s, title: label } : s
          )
        }))
      },
      spawnSubagentSession: async (agentId, prompt) => {
        const { client } = get()
        if (!client) return

        const session = await client.spawnSession(agentId, prompt)
        set((state) => ({
          sessions: [session, ...state.sessions],
          currentSessionId: session.key || session.id,
          messages: []
        }))

        // Load any existing messages for the spawned session
        const messages = await client.getSessionMessages(session.key || session.id)
        if (messages.length > 0) {
          set({ messages })
        }
      },

      // Agents
      agents: [],
      currentAgentId: null,
      setCurrentAgent: (agentId) => set({ currentAgentId: agentId }),

      // Skills & Crons
      skills: [],
      cronJobs: [],

      // Actions
      initializeApp: async () => {
        // Get config from platform (Electron, Capacitor, or web)
        const config = await Platform.getConfig()
        if (!get().serverUrl && config.defaultUrl) {
          set({ serverUrl: config.defaultUrl })
        }
        if (config.theme) {
          set({ theme: config.theme as 'dark' | 'light' })
        }

        // Load token from secure storage
        const secureToken = await Platform.getToken()
        if (secureToken) {
          set({ gatewayToken: secureToken })
        } else {
          // Migration: if Zustand has a token from old localStorage but secure storage is empty,
          // migrate it to secure storage
          const legacyToken = get().gatewayToken
          if (legacyToken) {
            await Platform.saveToken(legacyToken).catch(() => {})
          }
        }

        // Clean up legacy gatewayToken from localStorage
        try {
          const raw = localStorage.getItem('clawcontrol-storage')
          if (raw) {
            const parsed = JSON.parse(raw)
            if (parsed.state?.gatewayToken) {
              delete parsed.state.gatewayToken
              localStorage.setItem('clawcontrol-storage', JSON.stringify(parsed))
            }
          }
        } catch { /* ignore */ }

        // Show settings if no URL or token configured
        const { serverUrl, gatewayToken } = get()
        if (!serverUrl || !gatewayToken) {
          set({ showSettings: true })
          return
        }

        // Auto-connect
        try {
          await get().connect()
        } catch {
          // Show settings on connection failure
          set({ showSettings: true })
        }
      },

      connect: async () => {
        const { serverUrl, gatewayToken, client: existingClient, connecting } = get()

        // Prevent concurrent connect() calls (React StrictMode fires effects twice)
        if (connecting) {
          console.log('[ClawControl] connect() skipped — already connecting')
          return
        }

        // Show settings if URL is not configured
        if (!serverUrl) {
          set({ showSettings: true })
          return
        }

        // Disconnect existing client to prevent duplicate event handling
        if (existingClient) {
          console.log('[ClawControl] connect() disconnecting existing client')
          existingClient.disconnect()
          set({ client: null })
        }

        // Also kill any stale client surviving across Vite HMR reloads.
        const stale = (globalThis as any).__clawdeskClient as OpenClawClient | undefined
        if (stale && stale !== existingClient) {
          console.log('[ClawControl] connect() disconnecting stale HMR client')
          try { stale.disconnect() } catch { /* already closed */ }
        }

        set({ connecting: true })
        console.log('[ClawControl] connect() starting new connection')

        try {
          const { authMode } = get()
          const client = new OpenClawClient(serverUrl, gatewayToken, authMode)

          // Set up event handlers
          client.on('message', (msgArg: unknown) => {
            const message = msgArg as Message
            let replacedStreaming = false

            set((state) => {
              // Replace streaming placeholder with the final server message
              const lastIdx = state.messages.length - 1
              const lastMsg = lastIdx >= 0 ? state.messages[lastIdx] : null
              if (lastMsg && lastMsg.role === 'assistant' && lastMsg.id.startsWith('streaming-')) {
                replacedStreaming = true
                // Streamed content is already correct. Just stop the streaming state
                // without replacing the message object — avoids a visual flash from
                // React re-rendering / DOM replacement.
                return { isStreaming: false }
              }

              const exists = state.messages.some(m => m.id === message.id)
              if (exists) {
                return {
                  messages: state.messages.map(m => m.id === message.id ? message : m),
                  isStreaming: false
                }
              }
              return {
                messages: [...state.messages, message as Message],
                isStreaming: false
              }
            })

            // Only notify for non-streamed responses (streamEnd handles streamed ones)
            if (message.role === 'assistant' && !replacedStreaming) {
              const preview = message.content.slice(0, 100)
              const { notificationsEnabled, streamingSessionId: msgSession, currentSessionId: activeSession } = get()
              if (shouldNotify(notificationsEnabled, msgSession, activeSession)) {
                Platform.showNotification('Agent responded', preview).catch(() => {})
              }
            }
          })

          client.on('connected', () => {
            set({ connected: true, connecting: false })
          })

          client.on('disconnected', () => {
            set({ connected: false, isStreaming: false, hadStreamChunks: false, activeToolCalls: [] })
          })

          client.on('certError', (payload: unknown) => {
            const { httpsUrl } = payload as { url: string; httpsUrl: string }
            get().showCertErrorModal(httpsUrl)
          })

          client.on('streamStart', () => {
            set({ isStreaming: true, hadStreamChunks: false })
          })

          client.on('streamChunk', (chunkArg: unknown) => {
            const text = String(chunkArg)
            console.log('[ClawControl] streamChunk received, len:', text.length, 'preview:', JSON.stringify(text.slice(0, 40)))

            // Skip empty chunks
            if (!text) return

            set((state) => {
              const messages = [...state.messages]
              const lastMessage = messages[messages.length - 1]

              if (lastMessage && lastMessage.role === 'assistant') {
                const updatedMessage = { ...lastMessage, content: lastMessage.content + text }
                messages[messages.length - 1] = updatedMessage
                return { messages, isStreaming: true, hadStreamChunks: true }
              } else {
                // Create new assistant placeholder
                const newMessage: Message = {
                  id: `streaming-${Date.now()}`,
                  role: 'assistant',
                  content: text,
                  timestamp: new Date().toISOString()
                }
                return { messages: [...messages, newMessage], isStreaming: true, hadStreamChunks: true }
              }
            })
          })

          client.on('streamEnd', () => {
            const { streamingSessionId, currentSessionId, messages, hadStreamChunks } = get()

            // If streamEnd fires while we still have a streamingSessionId, the response completed
            if (streamingSessionId && hadStreamChunks) {
              const lastMsg = messages[messages.length - 1]
              if (lastMsg?.role === 'assistant') {
                const preview = lastMsg.content.slice(0, 100)
                const { notificationsEnabled, currentSessionId: activeSession } = get()
                if (shouldNotify(notificationsEnabled, streamingSessionId, activeSession)) {
                  Platform.showNotification('Agent responded', preview).catch(() => {})
                }
              }

              if (streamingSessionId !== currentSessionId) {
                set((state) => ({
                  unreadCounts: {
                    ...state.unreadCounts,
                    [streamingSessionId]: (state.unreadCounts[streamingSessionId] || 0) + 1
                  }
                }))
              }
            }

            set({ isStreaming: false, streamingSessionId: null, hadStreamChunks: false })
          })

          // When the server reports the canonical session key during streaming,
          // update local state so session lookups and history retrieval use the
          // correct key.
          client.on('streamSessionKey', (payload: unknown) => {
            const { sessionKey } = payload as { runId: string; sessionKey: string }
            if (!sessionKey) return

            const { streamingSessionId, currentSessionId } = get()
            const oldKey = streamingSessionId || currentSessionId
            if (!oldKey || sessionKey === oldKey) return

            set((state) => ({
              currentSessionId: state.currentSessionId === oldKey ? sessionKey : state.currentSessionId,
              streamingSessionId: state.streamingSessionId === oldKey ? sessionKey : state.streamingSessionId,
              sessions: state.sessions.map(s => {
                const sKey = s.key || s.id
                if (sKey === oldKey) {
                  return { ...s, id: sessionKey, key: sessionKey }
                }
                return s
              })
            }))
          })

          client.on('toolCall', (payload: unknown) => {
            const tc = payload as { toolCallId: string; name: string; phase: string; result?: string }
            set((state) => {
              const idx = state.activeToolCalls.findIndex(t => t.toolCallId === tc.toolCallId)
              if (idx >= 0) {
                const updated = [...state.activeToolCalls]
                updated[idx] = {
                  ...updated[idx],
                  phase: tc.phase as 'start' | 'result',
                  result: tc.result
                }
                return { activeToolCalls: updated }
              }
              return {
                activeToolCalls: [...state.activeToolCalls, {
                  toolCallId: tc.toolCallId,
                  name: tc.name,
                  phase: tc.phase as 'start' | 'result',
                  result: tc.result,
                  startedAt: Date.now()
                }]
              }
            })
          })

          await client.connect()
          ;(globalThis as any).__clawdeskClient = client
          set({ client })

          // Fetch initial data
          await Promise.all([
            get().fetchSessions(),
            get().fetchAgents(),
            get().fetchSkills(),
            get().fetchCronJobs()
          ])
        } catch {
          set({ connecting: false, connected: false })
        }
      },

      disconnect: () => {
        const { client } = get()
        client?.disconnect()
        if ((globalThis as any).__clawdeskClient === client) {
          (globalThis as any).__clawdeskClient = null
        }
        set({ client: null, connected: false })
      },

      sendMessage: async (content: string) => {
        const { client, currentSessionId, thinkingEnabled, currentAgentId } = get()
        if (!client || !content.trim()) return

        let sessionId = currentSessionId
        if (!sessionId) {
          const session = await client.createSession(currentAgentId || undefined)
          sessionId = session.key || session.id
          set((state) => ({
            sessions: [session, ...state.sessions],
            currentSessionId: sessionId,
            messages: []
          }))
        }

        // Reset streaming state so user can always send follow-up messages
        set({
          isStreaming: false,
          hadStreamChunks: false,
          activeToolCalls: [],
          streamingSessionId: sessionId
        })

        // Add user message immediately
        const userMessage: Message = {
          id: Date.now().toString(),
          role: 'user',
          content,
          timestamp: new Date().toISOString()
        }
        set((state) => ({ messages: [...state.messages, userMessage], isStreaming: true }))

        // Send to server
        try {
          await client.sendMessage({
            sessionId: sessionId,
            content,
            agentId: currentAgentId || undefined,
            thinking: thinkingEnabled
          })
        } catch {
          // If send fails, stop streaming state so UI remains usable.
          set({ isStreaming: false, streamingSessionId: null })
        }
      },

      fetchSessions: async () => {
        const { client } = get()
        if (!client) return
        const serverSessions = await client.listSessions()

        set((state) => {
          // Preserve local-only sessions (created but no message sent yet)
          // that aren't in the server's response.
          const serverKeys = new Set(serverSessions.map(s => s.key || s.id))
          const localOnly = state.sessions.filter(s => {
            const key = s.key || s.id
            return !serverKeys.has(key) && key.startsWith('agent:')
          })
          return { sessions: [...serverSessions, ...localOnly] }
        })
      },

      fetchAgents: async () => {
        const { client } = get()
        if (!client) return
        const agents = await client.listAgents()
        set({ agents })
        if (agents.length > 0 && !get().currentAgentId) {
          set({ currentAgentId: agents[0].id })
        }
      },

      fetchSkills: async () => {
        const { client } = get()
        if (!client) return
        const skills = await client.listSkills()
        set({ skills })
      },

      fetchCronJobs: async () => {
        const { client } = get()
        if (!client) return
        const cronJobs = await client.listCronJobs()
        set({ cronJobs })
      }
    }),
    {
  name: 'clawcontrol-storage',
      partialize: (state) => ({
        theme: state.theme,
        serverUrl: state.serverUrl,
        authMode: state.authMode,
        sidebarCollapsed: state.sidebarCollapsed,
        thinkingEnabled: state.thinkingEnabled,
        notificationsEnabled: state.notificationsEnabled
      })
    }
  )
)

// Vite HMR: disconnect stale WebSocket connections when modules are hot-replaced.
// Without this, old module versions keep processing events, causing duplicate streams.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    const { client } = useStore.getState()
    if (client) {
      client.disconnect()
    }
  })
}
