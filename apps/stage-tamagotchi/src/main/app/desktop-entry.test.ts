import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { installDevelopmentDesktopEntry, resolveDataHome } from './desktop-entry'

describe('installDevelopmentDesktopEntry', () => {
  let dataHome: string

  beforeEach(async () => {
    dataHome = await mkdtemp(join(tmpdir(), 'airi-desktop-entry-'))
  })

  afterEach(async () => {
    await rm(dataHome, { recursive: true, force: true })
  })

  it('writes the app id desktop file with quoted Exec arguments', async () => {
    const path = await installDevelopmentDesktopEntry({ dataHome, execPath: '/opt/my electron/electron', appPath: '/src/a"b$c\\d' })

    expect(path).toBe(join(dataHome, 'applications', 'ai.moeru.airi.desktop'))
    const entry = await readFile(path!, 'utf8')
    expect(entry.split('\n')).toContain('Exec="/opt/my electron/electron" "/src/a\\\\"b\\\\$c\\\\\\\\d"')
    expect(entry.startsWith('[Desktop Entry]\n')).toBe(true)
  })

  it('leaves an existing desktop file unchanged', async () => {
    const first = await installDevelopmentDesktopEntry({ dataHome, execPath: '/a', appPath: '/b' })
    await writeFile(first!, 'user edited')

    expect(await installDevelopmentDesktopEntry({ dataHome, execPath: '/c', appPath: '/d' })).toBeUndefined()
    expect(await readFile(first!, 'utf8')).toBe('user edited')
  })
})

describe('resolveDataHome', () => {
  it.each([
    [{ XDG_DATA_HOME: '/private/data' }, '/private/data'],
    [{ XDG_DATA_HOME: 'relative/data' }, '/home/me/.local/share'],
    [{}, '/home/me/.local/share'],
  ])('resolves %o to %s', (env, expected) => {
    expect(resolveDataHome(env, '/home/me')).toBe(expected)
  })
})
