import process from 'node:process'

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { linuxApplicationDirs, readDarwinApps, readLinuxApps } from './installed-apps'

function desktopFile(lines: string[]): string {
  return ['[Desktop Entry]', 'Type=Application', ...lines, '', '[Desktop Action new-window]', 'Name=Ignored action'].join('\n')
}

describe('installed apps', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'airi-installed-apps-'))
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(root, { recursive: true, force: true })
  })

  async function write(path: string, text: string) {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), text)
  }

  it('reads XDG application folders, most important first', () => {
    expect(linuxApplicationDirs({}, '/home/user')).toEqual(['/home/user/.local/share/applications', '/usr/local/share/applications', '/usr/share/applications'])
    expect(linuxApplicationDirs({ XDG_DATA_HOME: '/data', XDG_DATA_DIRS: '/a::/b' }, '/home/user')).toEqual(['/data/applications', '/a/applications', '/b/applications'])
  })

  it('lists launcher apps by desktop file id with their window class, letting the first folder win', async () => {
    await write('home/org.keepassxc.KeePassXC.desktop', desktopFile(['Name=KeePassXC']))
    await write('home/com.discordapp.Discord.desktop', desktopFile(['Name=Discord', 'StartupWMClass=discord']))
    await write('home/firefox.desktop', desktopFile(['Name=Firefox', 'Hidden=true']))
    await write('system/firefox.desktop', desktopFile(['Name=Firefox']))
    await write('system/kde/konsole.desktop', desktopFile(['Name=Konsole']))
    await write('system/daemon.desktop', desktopFile(['Name=Daemon', 'NoDisplay=true']))
    await write('system/link.desktop', ['[Desktop Entry]', 'Type=Link', 'Name=Link'].join('\n'))
    await write('system/nameless.desktop', desktopFile([]))
    await write('system/readme.txt', 'not an app')

    const apps = await readLinuxApps([join(root, 'home'), join(root, 'missing'), join(root, 'system')])

    expect(apps).toEqual(expect.arrayContaining([
      { name: 'KeePassXC', appKey: 'org.keepassxc.KeePassXC', windowClass: null },
      { name: 'Discord', appKey: 'com.discordapp.Discord', windowClass: 'discord' },
      { name: 'Konsole', appKey: 'kde-konsole', windowClass: null },
      { name: 'nameless', appKey: 'nameless', windowClass: null },
    ]))
    expect(apps).toHaveLength(4)
  })

  it.runIf(process.platform === 'linux')('finds every desktop file id that declares a window class once the list loaded', async () => {
    await write('home/applications/com.discordapp.Discord.desktop', desktopFile(['Name=Discord', 'StartupWMClass=discord']))
    await write('home/applications/discord.desktop', desktopFile(['Name=Discord', 'StartupWMClass=Discord']))
    vi.stubEnv('XDG_DATA_HOME', join(root, 'home'))
    vi.stubEnv('XDG_DATA_DIRS', join(root, 'missing'))
    vi.resetModules()
    const { desktopIdsForClass, listInstalledApps } = await import('./installed-apps')

    expect(desktopIdsForClass('discord')).toEqual([])
    expect(await listInstalledApps()).toHaveLength(2)
    expect(desktopIdsForClass('Discord')).toEqual(['com.discordapp.Discord', 'discord'])
    expect(desktopIdsForClass('konsole')).toEqual([])
  })

  it('lists .app bundles once each', async () => {
    await mkdir(join(root, 'Applications', 'Bitwarden.app'), { recursive: true })
    await mkdir(join(root, 'Applications', 'Notes folder'), { recursive: true })
    await mkdir(join(root, 'System', 'bitwarden.app'), { recursive: true })
    await mkdir(join(root, 'System', 'Safari.app'), { recursive: true })

    const apps = await readDarwinApps([join(root, 'Applications'), join(root, 'System'), join(root, 'missing')])

    expect(apps).toEqual([{ name: 'Bitwarden', appKey: 'Bitwarden.app', windowClass: null }, { name: 'Safari', appKey: 'Safari.app', windowClass: null }])
  })
})
