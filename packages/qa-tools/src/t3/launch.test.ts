import type { Lease } from '@proj-airi/cpu-slots'

import { ChildProcess } from 'node:child_process'
import { devNull } from 'node:os'
import { PassThrough } from 'node:stream'

import { acquire } from '@proj-airi/cpu-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as remoteDebug from '@proj-airi/scenarios-stage-tamagotchi-electron/runtime/remote-debug'

import { devScriptArgs, fatalStartupPattern, launchStageTamagotchi, stageTargetPattern, t3LaunchEnv } from './launch'

import * as pnpm from '../env/pnpm'

vi.mock('@proj-airi/cpu-slots', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/cpu-slots')>(),
  acquire: vi.fn(),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('t3LaunchEnv', () => {
  it('sets the fresh profile, the debug port without the browser, and the bridge gate', () => {
    expect(t3LaunchEnv('C:/run/profile', 9333)).toEqual({
      APP_USER_DATA_PATH: 'C:/run/profile',
      APP_REMOTE_DEBUG: 'true',
      APP_REMOTE_DEBUG_PORT: '9333',
      APP_REMOTE_DEBUG_NO_OPEN: 'true',
      APP_MOTION_QA_BRIDGE: 'true',
    })
  })
})

describe('devScriptArgs', () => {
  it('runs the script alone without Electron arguments', () => {
    expect(devScriptArgs('dev', [])).toEqual(['dev'])
    expect(devScriptArgs('dev:xwayland', [])).toEqual(['dev:xwayland'])
  })

  it('hands Electron arguments to electron-vite after its separator', () => {
    expect(devScriptArgs('dev', ['--use-gl=angle', '--ignore-gpu-blocklist'])).toEqual(['dev', '--', '--use-gl=angle', '--ignore-gpu-blocklist'])
    // dev:xwayland already ends with `-- --ozone-platform=x11`, so a second separator would end Chromium's switches.
    expect(devScriptArgs('dev:xwayland', ['--use-gl=angle'])).toEqual(['dev:xwayland', '--use-gl=angle'])
  })
})

/** A pnpm root that never runs: piped output streams and a fixed pid, exited by the test. */
class FakeDevRoot extends ChildProcess {
  override stdout = new PassThrough()
  override stderr = new PassThrough()
  override readonly pid = 4242
  override readonly spawnargs = ['fake-dev-root']
}

describe('launchStageTamagotchi', () => {
  /** Launches with a fake pnpm child, a fake lease and a fixed port, and returns the pnpm arguments it spawned. */
  async function spawnedArgs(options: { script?: 'dev' | 'dev:xwayland', electronArgs?: readonly string[] }): Promise<readonly string[]> {
    const lease: Lease = { id: 'test', grant: null, exclusive: true, inherited: false, env: {}, addWorkload: vi.fn(), release: vi.fn() }
    vi.mocked(acquire).mockResolvedValue(lease)
    vi.spyOn(remoteDebug, 'findAvailablePort').mockResolvedValue(9333)
    const child = new FakeDevRoot()
    const spawn = vi.spyOn(pnpm, 'spawnPnpm').mockReturnValue(child)
    const app = await launchStageTamagotchi({ repoRoot: '/repo', profileDir: '/run/profile', logFile: devNull, list: async () => [], ...options })
    child.emit('exit', 0)
    await app.exited
    app.releaseLease()
    expect(lease.release).toHaveBeenCalledOnce()
    return spawn.mock.lastCall![0]
  }

  it('passes Electron switches to the spawned dev script', async () => {
    expect(await spawnedArgs({ electronArgs: ['--use-gl=angle', '--use-angle=swiftshader'] }))
      .toEqual(['--dir', '/repo', '-F', '@proj-airi/stage-tamagotchi', 'dev', '--', '--use-gl=angle', '--use-angle=swiftshader'])
    expect(await spawnedArgs({ script: 'dev:xwayland', electronArgs: ['--ignore-gpu-blocklist'] }))
      .toEqual(['--dir', '/repo', '-F', '@proj-airi/stage-tamagotchi', 'dev:xwayland', '--ignore-gpu-blocklist'])
  })

  it('spawns the bare dev script without Electron switches', async () => {
    expect(await spawnedArgs({})).toEqual(['--dir', '/repo', '-F', '@proj-airi/stage-tamagotchi', 'dev'])
  })
})

describe('stageTargetPattern', () => {
  it('matches only the synced leader on the root route', () => {
    expect(stageTargetPattern.test('http://localhost:5174/?synced-leader=true#/')).toBe(true)
    expect(stageTargetPattern.test('http://localhost:5174/?synced-leader=true#/settings')).toBe(false)
    expect(stageTargetPattern.test('http://localhost:5174/#/')).toBe(false)
  })
})

describe('fatalStartupPattern', () => {
  it('captures the load error and the line after it', () => {
    const log = 'starting electron app...\nApp threw an error during load\nError: EBUSY: resource busy or locked, open \'x.js\'\n    at Object.openSync'
    expect(fatalStartupPattern.exec(log)?.[0]).toBe('App threw an error during load\nError: EBUSY: resource busy or locked, open \'x.js\'')
  })

  it('ignores ordinary dev output', () => {
    expect(fatalStartupPattern.test('electron main process built successfully\nstarting electron app...')).toBe(false)
  })
})
