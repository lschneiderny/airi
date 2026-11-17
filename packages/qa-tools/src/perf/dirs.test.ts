import { describe, expect, it } from 'vitest'

import { defaultPerfDirs } from './dirs'

describe('defaultPerfDirs', () => {
  it.each([
    [{ platform: 'linux', env: {}, homedir: '/home/user' }, ['/home/user/.config/@proj-airi/stage-tamagotchi/perf', '/home/user/.config/ai.moeru.airi/perf']],
    [{ platform: 'linux', env: { XDG_CONFIG_HOME: '/xdg' }, homedir: '/home/user' }, ['/xdg/@proj-airi/stage-tamagotchi/perf', '/xdg/ai.moeru.airi/perf']],
    [{ platform: 'darwin', env: { XDG_CONFIG_HOME: '/ignored' }, homedir: '/Users/luke' }, ['/Users/luke/Library/Application Support/@proj-airi/stage-tamagotchi/perf', '/Users/luke/Library/Application Support/ai.moeru.airi/perf']],
    [{ platform: 'win32', env: { APPDATA: 'C:\\Users\\luke\\AppData\\Roaming' }, homedir: 'C:\\Users\\luke' }, ['C:\\Users\\luke\\AppData\\Roaming\\@proj-airi\\stage-tamagotchi\\perf', 'C:\\Users\\luke\\AppData\\Roaming\\ai.moeru.airi\\perf']],
    [{ platform: 'win32', env: {}, homedir: 'C:\\Users\\luke' }, ['C:\\Users\\luke\\AppData\\Roaming\\@proj-airi\\stage-tamagotchi\\perf', 'C:\\Users\\luke\\AppData\\Roaming\\ai.moeru.airi\\perf']],
  ] as const)('resolves the dev and packaged dirs for %j', (host, expected) => {
    expect(defaultPerfDirs(host)).toEqual(expected)
  })
})
