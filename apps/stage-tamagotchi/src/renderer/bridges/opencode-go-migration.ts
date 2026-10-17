import type { GoClient } from './opencode-go-client'

import { isPlainObject } from 'es-toolkit'
import { parse, record, string, unknown } from 'valibot'

const snapshotSchema = record(string(), unknown())
const baseUrl = 'https://opencode.ai/inference/go/v1/'

function requireOfficialEndpoint(config: Record<string, unknown>) {
  if (config.baseUrl === undefined)
    return
  if (typeof config.baseUrl !== 'string')
    throw new TypeError('OpenCode Go endpoint must be a URL')
  const url = new URL(config.baseUrl)
  if (url.origin !== 'https://opencode.ai' || url.username || url.password || url.search || url.hash
    || !['/inference/go/v1', '/zen/go/v1'].includes(url.pathname.replace(/\/$/, ''))) {
    throw new Error('Re-enter the Go key in desktop settings before changing from a custom endpoint')
  }
}

/** Provider snapshots retain model choices, but never retain the main-owned key. */
export function toGoConfig(config: Record<string, unknown>, providerId: string, revision: number): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config, credentialId: providerId, credentialRevision: revision, baseUrl }
  delete next.apiKey
  return next
}

/**
 * Transfer keys before the leader creates synchronized stores. Durable main
 * acknowledgment precedes removal of renderer copies. Other providers stay intact.
 */
export async function migrateGoCredentials(storage: Storage, client: GoClient): Promise<void> {
  const configuredKey = 'settings/providers/configured'
  const legacyKey = 'settings/credentials/providers'
  const configured = parse(snapshotSchema, JSON.parse(storage.getItem(configuredKey) ?? '{}'))
  const legacy = parse(snapshotSchema, JSON.parse(storage.getItem(legacyKey) ?? '{}'))
  const transferred = new Set<string>()

  for (const [providerId, value] of Object.entries(configured)) {
    if (!isPlainObject(value) || value.definitionId !== 'opencode-go' || !isPlainObject(value.config))
      continue
    const config = value.config
    if (typeof config.apiKey === 'string' && config.apiKey.trim())
      requireOfficialEndpoint(config)
    const state = typeof config.apiKey === 'string' && config.apiKey.trim()
      ? await client.setConfiguration(providerId, config.apiKey)
      : await client.getConfiguration(providerId)
    configured[providerId] = { ...value, config: toGoConfig(config, providerId, state.revision) }
    transferred.add(providerId)
  }

  for (const [providerId, value] of Object.entries(legacy)) {
    if (!['opencode-go', 'vision-opencode-go'].includes(providerId) || !isPlainObject(value))
      continue
    if (!transferred.has(providerId) && typeof value.apiKey === 'string' && value.apiKey.trim()) {
      requireOfficialEndpoint(value)
      const state = await client.setConfiguration(providerId, value.apiKey)
      configured[providerId] = {
        id: providerId,
        definitionId: 'opencode-go',
        config: toGoConfig(value, providerId, state.revision),
        configuredBy: 'user',
        status: 'unconfigured',
      }
    }
    delete legacy[providerId]
  }

  storage.setItem(configuredKey, JSON.stringify(configured))
  storage.setItem(legacyKey, JSON.stringify(legacy))
}
