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
export function normalizeAgentId(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return 'main'
  if (/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(trimmed)) {
    return trimmed.toLowerCase()
  }
  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 64)
  return normalized || 'main'
}

/**
 * Reads the full server config via config.get.
 * Returns the raw config object and the hash needed for config.patch.
 */
export async function getConfig(call: RpcCaller): Promise<{ config: any; hash: string }> {
  const result = await call<any>('config.get', {})

  // config.get returns a ConfigFileSnapshot: { config, hash, path, exists, valid, ... }
  // Extract the config object and hash, with defensive fallbacks
  const config = result?.config ?? null
  const hash = result?.hash ?? ''

  console.log('[ClawControl] config.get response keys:', Object.keys(result || {}))
  console.log('[ClawControl] config.agents type:', typeof config?.agents,
    'agents.list type:', typeof config?.agents?.list,
    'agents.list length:', Array.isArray(config?.agents?.list) ? config.agents.list.length : 'N/A')

  return { config, hash }
}

/**
 * Create a new agent by patching the server config.
 *
 * This ONLY patches the config (adds the agent entry to agents.list).
 * It does NOT write IDENTITY.md because config.patch triggers a server
 * restart, and agents.files.set won't work until the server comes back
 * with the new config loaded. The caller (store) handles writing
 * IDENTITY.md after reconnection.
 */
export async function createAgent(call: RpcCaller, params: CreateAgentParams): Promise<CreateAgentResult> {
  const agentId = normalizeAgentId(params.name)
  if (agentId === 'main') {
    throw new Error('"main" is reserved and cannot be used as an agent name')
  }

  // 1. Get current config and hash
  const { config, hash } = await getConfig(call)

  if (!config || typeof config !== 'object') {
    throw new Error('Failed to read server config — config.get returned unexpected data')
  }
  if (!hash) {
    throw new Error('Failed to read config hash — config.get did not return a baseHash')
  }

  // 2. Extract the existing agents list — must preserve every entry
  const agentsSection = config.agents || {}
  const existingList: any[] = Array.isArray(agentsSection.list) ? agentsSection.list : []

  console.log('[ClawControl] Existing agents in config:', existingList.map((a: any) => a.id || a.name))

  // 3. Check for duplicates
  if (existingList.some((a: any) => normalizeAgentId(a.id || a.name || '') === agentId)) {
    throw new Error(`Agent "${agentId}" already exists`)
  }

  // 4. Build the new agent config entry
  const newAgent: Record<string, any> = {
    id: agentId,
    name: params.name.trim(),
    workspace: params.workspace.trim()
  }
  if (params.model) {
    newAgent.model = params.model
  }

  // 5. Build patch — ONLY touch agents.list, preserve everything else via merge patch
  //    Send ONLY { agents: { list: [...] } } so the merge patch:
  //      - recursively enters the agents object (it's a plain object)
  //      - replaces the list array with our full new array
  //      - leaves agents.defaults and all other config sections untouched
  const newList = [...existingList, newAgent]
  const patch = { agents: { list: newList } }

  console.log('[ClawControl] Patching config with', newList.length, 'agents (was', existingList.length, ')')

  await call<any>('config.patch', { raw: JSON.stringify(patch), baseHash: hash })

  return {
    ok: true,
    agentId,
    name: params.name.trim(),
    workspace: params.workspace.trim()
  }
}

/**
 * Build the IDENTITY.md content string for a new agent.
 */
export function buildIdentityContent(params: { name: string; emoji?: string; avatar?: string }): string {
  const lines = [`- Name: ${params.name.trim()}`]
  if (params.emoji) lines.push(`- Emoji: ${params.emoji}`)
  if (params.avatar) lines.push(`- Avatar: ${params.avatar}`)
  return lines.join('\n') + '\n'
}
