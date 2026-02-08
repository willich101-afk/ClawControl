// OpenClaw Client - Agent API Methods

import type { Agent, RpcCaller } from './types'
import { resolveAvatarUrl } from './utils'

export async function listAgents(call: RpcCaller, wsUrl: string): Promise<Agent[]> {
  try {
    const result = await call<any>('agents.list')
    const agents = Array.isArray(result) ? result : (result?.agents || result?.items || result?.list || [])

    // Enrich each agent with identity from agent.identity.get
    const enrichedAgents: Agent[] = []
    for (const a of agents) {
      const agentId = String(a.agentId || a.id || 'main')
      let identity = a.identity || {}

      // Fetch identity if not already included
      if (!identity.name && !identity.avatar) {
        try {
          const fetchedIdentity = await call<any>('agent.identity.get', { agentId })
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
      const avatarUrl = resolveAvatarUrl(identity.avatarUrl || identity.avatar, agentId, wsUrl)

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

export async function getAgentIdentity(call: RpcCaller, agentId: string): Promise<{ name?: string; emoji?: string; avatar?: string; avatarUrl?: string } | null> {
  try {
    return await call<any>('agent.identity.get', { agentId })
  } catch {
    return null
  }
}

export async function getAgentFiles(call: RpcCaller, agentId: string): Promise<{ workspace: string; files: Array<{ name: string; path: string; missing: boolean; size?: number }> } | null> {
  try {
    return await call<any>('agents.files.list', { agentId })
  } catch {
    return null
  }
}

export async function getAgentFile(call: RpcCaller, agentId: string, fileName: string): Promise<{ content?: string; missing: boolean } | null> {
  try {
    const result = await call<any>('agents.files.get', { agentId, name: fileName })
    return result?.file || null
  } catch {
    return null
  }
}

export async function setAgentFile(call: RpcCaller, agentId: string, fileName: string, content: string): Promise<boolean> {
  try {
    await call<any>('agents.files.set', { agentId, name: fileName, content })
    return true
  } catch {
    return false
  }
}

export interface CreateAgentParams {
  name: string
  workspace: string
  emoji?: string
  avatar?: string
}

export interface CreateAgentResult {
  ok: boolean
  agentId: string
  name: string
  workspace: string
}

export async function createAgent(call: RpcCaller, params: CreateAgentParams): Promise<CreateAgentResult> {
  const result = await call<any>('agents.create', {
    name: params.name,
    workspace: params.workspace,
    ...(params.emoji ? { emoji: params.emoji } : {}),
    ...(params.avatar ? { avatar: params.avatar } : {})
  })
  return result
}

export async function updateAgent(call: RpcCaller, params: { agentId: string; name?: string; workspace?: string; model?: string; avatar?: string }): Promise<boolean> {
  try {
    await call<any>('agents.update', params)
    return true
  } catch {
    return false
  }
}
