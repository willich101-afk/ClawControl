// ClawHub API Client - Public registry for OpenClaw skills

import { corsFetch } from './platform'

const CLAWHUB_API = 'https://clawhub.ai/api/v1'

export interface ClawHubVersionFile {
  path: string
  size: number
  contentType: string
}

export interface ClawHubVtAnalysis {
  status: 'benign' | 'suspicious' | 'malicious' | 'not_found' | 'pending' | 'error'
  analysis?: string
  source?: string
  checkedAt?: number
  vtUrl?: string
  stats?: {
    malicious: number
    suspicious: number
    harmless: number
    undetected: number
  }
}

export interface ClawHubSkill {
  slug: string
  name: string
  description: string
  owner: { username: string; image?: string }
  downloads: number
  stars: number
  version: string
  tags: string[]
  updatedAt: string
  changelog?: string
  versionFiles?: ClawHubVersionFile[]
  vtAnalysis?: ClawHubVtAnalysis
}

export type ClawHubSort = 'downloads' | 'stars' | 'trending' | 'updated'

async function fetchJson(url: string): Promise<any> {
  const text = await corsFetch(url)
  return JSON.parse(text)
}

export async function searchClawHub(query: string, limit = 30): Promise<ClawHubSkill[]> {
  const url = `${CLAWHUB_API}/search?q=${encodeURIComponent(query)}&limit=${limit}`
  const data = await fetchJson(url)
  // Search results: { results: [{ slug, displayName, summary, version, updatedAt, score }] }
  const items = data?.results || []
  return items.map(normalizeSearchResult)
}

export async function listClawHubSkills(sort: ClawHubSort = 'downloads', limit = 30): Promise<ClawHubSkill[]> {
  const url = `${CLAWHUB_API}/skills?sort=${sort}&limit=${limit}`
  const data = await fetchJson(url)
  // List results: { items: [{ slug, displayName, summary, tags, stats, createdAt, updatedAt, latestVersion }] }
  const items = data?.items || []
  return items.map(normalizeListItem)
}

export async function getClawHubSkill(slug: string): Promise<ClawHubSkill | null> {
  const url = `${CLAWHUB_API}/skills/${encodeURIComponent(slug)}`
  try {
    const data = await fetchJson(url)
    // Detail result: { skill: {...}, latestVersion: {...}, owner: { handle, displayName, image } }
    return normalizeDetailResult(data)
  } catch {
    return null
  }
}

// Normalize a list item from /api/v1/skills
function normalizeListItem(s: any): ClawHubSkill {
  const stats = s.stats || {}
  return {
    slug: s.slug || '',
    name: s.displayName || s.slug || 'Unnamed',
    description: s.summary || '',
    owner: { username: '' },
    downloads: stats.downloads || 0,
    stars: stats.stars || 0,
    version: s.latestVersion?.version || s.tags?.latest || '',
    tags: extractTags(s.tags),
    updatedAt: formatTimestamp(s.updatedAt)
  }
}

// Normalize a search result from /api/v1/search
function normalizeSearchResult(s: any): ClawHubSkill {
  return {
    slug: s.slug || '',
    name: s.displayName || s.slug || 'Unnamed',
    description: s.summary || '',
    owner: { username: '' },
    downloads: 0,
    stars: 0,
    version: s.version || '',
    tags: [],
    updatedAt: formatTimestamp(s.updatedAt)
  }
}

// Normalize a detail result from /api/v1/skills/:slug
function normalizeDetailResult(data: any): ClawHubSkill {
  const s = data?.skill || data || {}
  const stats = s.stats || {}
  const owner = data?.owner || {}
  return {
    slug: s.slug || '',
    name: s.displayName || s.slug || 'Unnamed',
    description: s.summary || '',
    owner: {
      username: owner.handle || owner.displayName || '',
      image: owner.image
    },
    downloads: stats.downloads || 0,
    stars: stats.stars || 0,
    version: data?.latestVersion?.version || s.tags?.latest || '',
    tags: extractTags(s.tags),
    updatedAt: formatTimestamp(s.updatedAt)
  }
}

// Fetch version details (files, changelog) for a skill
export async function getClawHubSkillVersion(slug: string, version: string): Promise<{ changelog?: string; files: ClawHubVersionFile[] } | null> {
  const url = `${CLAWHUB_API}/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`
  try {
    const data = await fetchJson(url)
    const v = data?.version || {}
    const files: ClawHubVersionFile[] = (v.files || []).map((f: any) => ({
      path: f.path || '',
      size: f.size || 0,
      contentType: f.contentType || ''
    }))
    return {
      changelog: v.changelog || undefined,
      files
    }
  } catch {
    return null
  }
}

// tags from the API is an object like { latest: "1.0.0" }, not an array
function extractTags(tags: any): string[] {
  if (Array.isArray(tags)) return tags
  if (tags && typeof tags === 'object') {
    // Exclude the "latest" key which just holds the version
    return Object.keys(tags).filter(k => k !== 'latest')
  }
  return []
}

function formatTimestamp(ts: any): string {
  if (!ts) return ''
  if (typeof ts === 'number') return new Date(ts).toISOString()
  return String(ts)
}

// Convex backend for data not available via public REST API (e.g. VT scan results)
const CONVEX_URL = 'https://wry-manatee-359.convex.cloud'

// Fetch skill detail from Convex (includes vtAnalysis and version sha256hash)
export async function getClawHubSkillConvex(slug: string): Promise<{ vtAnalysis?: ClawHubVtAnalysis; sha256hash?: string } | null> {
  try {
    const res = await corsFetch(`${CONVEX_URL}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Convex-Client': 'npm-1.0.0' },
      body: JSON.stringify({ path: 'skills:getBySlug', args: { slug }, format: 'json' })
    })
    const data = JSON.parse(res)
    if (data?.status !== 'success' || !data?.value) return null

    const version = data.value.latestVersion
    const vt = version?.vtAnalysis
    const sha256hash = version?.sha256hash

    const result: { vtAnalysis?: ClawHubVtAnalysis; sha256hash?: string } = {}

    if (vt) {
      result.vtAnalysis = {
        status: normalizeVtStatus(vt.status || vt.verdict),
        analysis: vt.analysis,
        source: vt.source,
        checkedAt: vt.checkedAt
      }
    }

    if (sha256hash) {
      result.sha256hash = sha256hash
      // If we have the hash but no inline VT data, try the VT action
      if (!vt) {
        const vtResult = await fetchVtResults(sha256hash)
        if (vtResult) result.vtAnalysis = vtResult
      } else if (sha256hash) {
        // Add VT URL from hash
        result.vtAnalysis!.vtUrl = `https://www.virustotal.com/gui/file/${sha256hash}`
      }
    }

    return result
  } catch {
    return null
  }
}

// Fetch VT results directly via Convex action
async function fetchVtResults(sha256hash: string): Promise<ClawHubVtAnalysis | null> {
  try {
    const res = await corsFetch(`${CONVEX_URL}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Convex-Client': 'npm-1.0.0' },
      body: JSON.stringify({ path: 'vt:fetchResults', args: { sha256hash }, format: 'json' })
    })
    const data = JSON.parse(res)
    if (data?.status !== 'success' || !data?.value) return null

    const v = data.value
    if (v.status === 'not_found') return { status: 'not_found' }

    return {
      status: normalizeVtStatus(v.status),
      analysis: v.metadata?.aiAnalysis,
      source: v.source,
      vtUrl: v.url,
      stats: v.metadata?.stats ? {
        malicious: v.metadata.stats.malicious || 0,
        suspicious: v.metadata.stats.suspicious || 0,
        harmless: v.metadata.stats.harmless || 0,
        undetected: v.metadata.stats.undetected || 0
      } : undefined
    }
  } catch {
    return null
  }
}

function normalizeVtStatus(status: string | undefined): ClawHubVtAnalysis['status'] {
  if (!status) return 'not_found'
  const s = status.toLowerCase()
  if (s === 'benign' || s === 'clean') return 'benign'
  if (s === 'malicious') return 'malicious'
  if (s === 'suspicious') return 'suspicious'
  if (s === 'pending' || s === 'loading') return 'pending'
  if (s === 'error') return 'error'
  return 'not_found'
}
