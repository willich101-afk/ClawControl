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
  model?: string
  emoji?: string
  avatar?: string
}

export interface CreateAgentResult {
  ok: boolean
  agentId: string
  name: string
  workspace: string
}

// Normalize agent name to a safe ID (mirrors server-side normalizeAgentId)
function normalizeAgentId(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return 'main'
  // If already valid, just lowercase
  if (/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(trimmed)) {
    return trimmed.toLowerCase()
  }
  // Collapse invalid chars to hyphens
  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 64)
  return normalized || 'main'
}

interface ConfigSnapshot {
  config: any
  hash: string
}

async function getConfig(call: RpcCaller): Promise<ConfigSnapshot> {
  const result = await call<any>('config.get', {})
  return { config: result.config || result, hash: result.hash || '' }
}

async function patchConfig(call: RpcCaller, raw: string, baseHash: string): Promise<any> {
  return call<any>('config.patch', { raw, baseHash })
}

export async function createAgent(call: RpcCaller, params: CreateAgentParams): Promise<CreateAgentResult> {
  // 1. Get current config and hash
  const { config, hash } = await getConfig(call)

  // 2. Validate the agent ID
  const agentId = normalizeAgentId(params.name)
  if (agentId === 'main') {
    throw new Error('"main" is reserved and cannot be used as an agent name')
  }

  // 3. Build the existing agents list
  const existingList: any[] = config?.agents?.list || []

  // Check for duplicates
  const exists = existingList.some((a: any) => {
    const id = normalizeAgentId(a.id || a.name || '')
    return id === agentId
  })
  if (exists) {
    throw new Error(`Agent "${agentId}" already exists`)
  }

  // 4. Build the new agent config entry
  const newAgent: any = {
    id: agentId,
    name: params.name.trim(),
    workspace: params.workspace.trim()
  }
  if (params.model) {
    newAgent.model = params.model
  }

  // 5. Patch config with the new agents list
  const newList = [...existingList, newAgent]
  const patch = { agents: { ...config?.agents, list: newList } }
  await patchConfig(call, JSON.stringify(patch), hash)

  // 6. If emoji or avatar provided, write them to IDENTITY.md via agents.files.set
  if (params.emoji || params.avatar) {
    const identityLines: string[] = [
      '',
      `- Name: ${params.name.trim()}`
    ]
    if (params.emoji) {
      identityLines.push(`- Emoji: ${params.emoji}`)
    }
    if (params.avatar) {
      identityLines.push(`- Avatar: ${params.avatar}`)
    }
    identityLines.push('')

    try {
      await call<any>('agents.files.set', {
        agentId,
        name: 'IDENTITY.md',
        content: identityLines.join('\n')
      })
    } catch {
      // Identity write failed - agent was still created in config
      console.warn('[ClawControl] Failed to write IDENTITY.md for new agent:', agentId)
    }
  }

  return {
    ok: true,
    agentId,
    name: params.name.trim(),
    workspace: params.workspace.trim()
  }
}
