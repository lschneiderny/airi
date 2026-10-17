import type { GoConfiguration } from '../../../../shared/eventa/opencode-go'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { platform } from 'node:process'

import { app, safeStorage } from 'electron'
import { array, integer, literal, minValue, number, parse, pipe, strictObject, string } from 'valibot'

const schema = strictObject({
  version: literal(1),
  profiles: array(strictObject({
    providerId: string(),
    ciphertext: string(),
    revision: pipe(number(), integer(), minValue(0)),
    keyPreview: string(),
  })),
})
type Stored = ReturnType<typeof parse<typeof schema>>

/** Serializes durable encrypted writes before renderer copies can be removed. */
export class Credentials {
  private readonly path = join(app.getPath('userData'), 'opencode-go-v1.json')
  private stored: Stored = { version: 1, profiles: [] }
  private updates: Promise<void> = Promise.resolve()
  private disposed = false

  constructor() {
    if (existsSync(this.path))
      this.stored = parse(schema, JSON.parse(readFileSync(this.path, 'utf8')))
  }

  async get(providerId: string): Promise<GoConfiguration> {
    await this.updates
    return this.publicConfiguration(providerId)
  }

  private publicConfiguration(providerId: string): GoConfiguration {
    const profile = this.stored.profiles.find(profile => profile.providerId === providerId)
    return { configured: Boolean(profile?.ciphertext), revision: profile?.revision ?? 0, keyPreview: profile?.keyPreview ?? '' }
  }

  private async requireEncryption() {
    if (!await safeStorage.isAsyncEncryptionAvailable()
      || (platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
      throw new Error('OpenCode Go requires secure operating system credential storage')
    }
  }

  async key(providerId: string): Promise<string> {
    await this.updates
    await this.requireEncryption()
    const profile = this.stored.profiles.find(profile => profile.providerId === providerId)
    if (!profile?.ciphertext)
      throw new Error('OpenCode Go is not configured')
    const { result } = await safeStorage.decryptStringAsync(Buffer.from(profile.ciphertext, 'base64'))
    return result
  }

  set(providerId: string, apiKey: string): Promise<GoConfiguration> {
    const operation = this.updates.then(async () => {
      if (this.disposed)
        throw new Error('OpenCode Go credential storage is disposed')
      const key = apiKey.trim()
      let ciphertext = ''
      if (key) {
        await this.requireEncryption()
        try {
          ciphertext = (await safeStorage.encryptStringAsync(key)).toString('base64')
        }
        catch {
          throw new Error('OpenCode Go credential encryption failed')
        }
      }
      const profile = {
        providerId,
        ciphertext,
        revision: this.publicConfiguration(providerId).revision + 1,
        keyPreview: key ? `****${key.length > 8 ? key.slice(-4) : ''}` : '',
      }
      const next: Stored = {
        version: 1,
        profiles: [...this.stored.profiles.filter(item => item.providerId !== providerId), profile],
      }
      const temporary = `${this.path}.${randomUUID()}.tmp`
      try {
        await mkdir(dirname(this.path), { recursive: true })
        await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flush: true })
        await rename(temporary, this.path)
      }
      catch {
        try {
          await rm(temporary, { force: true })
        }
        catch {
          // Cleanup is best effort. The caller still receives the credential save failure.
        }
        throw new Error('OpenCode Go credential save failed')
      }
      this.stored = next
      return this.publicConfiguration(providerId)
    })
    // The caller receives the original rejection. Later writes still run after a failed save.
    this.updates = operation.then(() => {}, () => {})
    return operation
  }

  async dispose(): Promise<void> {
    this.disposed = true
    await this.updates
  }
}
