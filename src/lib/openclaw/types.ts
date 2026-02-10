// OpenClaw Protocol v3 - Type Definitions

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

export interface RequestFrame {
  type: 'req'
  id: string
  method: string
  params?: any
}

export interface ResponseFrame {
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

export interface EventFrame {
  type: 'event'
  event: string
  payload?: any
}

export type EventHandler = (...args: unknown[]) => void

export type RpcCaller = <T = any>(method: string, params?: any, options?: { timeoutMs?: number }) => Promise<T>
