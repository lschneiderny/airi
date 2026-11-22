import type { RegistrySource } from './storage-writes'

import { describe, expect, it } from 'vitest'

import { checkStorageWrites, findStorageWrites, readStateRegistry } from './storage-writes'

const file = 'packages/stage-ui/src/stores/example.ts'

function keysOf(source: string, path = file, read?: (path: string) => string | undefined) {
  return findStorageWrites(path, source, read).map(site => site.key)
}

describe('findStorageWrites', () => {
  it('resolves literal, template, and same-file constant keys', () => {
    const source = [
      `const KEY = 'settings/example/a'`,
      `const prefix = 'settings/example'`,
      `useLocalStorage('settings/example/b', 1)`,
      `localStorage.setItem(\`expression-rest:\${modelId.value}\`, '1')`,
      `useLocalStorageManualReset(KEY, 1)`,
      `window.localStorage.setItem(\`\${prefix}/c\`, '1')`,
    ].join('\n')

    expect(keysOf(source)).toEqual([
      { exact: 'settings/example/b' },
      { prefix: 'expression-rest:' },
      { exact: 'settings/example/a' },
      { exact: 'settings/example/c' },
    ])
  })

  it('resolves a member of an `as const` table that a relative import names', () => {
    const constants = `export const speechStorageKeys = { voice: 'settings/speech/voice' } as const`
    const read = (path: string) => path === 'packages/stage-ui/src/constants/settings-storage.ts' ? constants : undefined
    const source = [
      `import { speechStorageKeys } from '../constants/settings-storage'`,
      `useLocalStorageManualReset(speechStorageKeys.voice, '')`,
    ].join('\n')

    expect(keysOf(source, file, read)).toEqual([{ exact: 'settings/speech/voice' }])
  })

  it('reads a per-model call by its unscoped key, and a loop or a helper parameter by each key it gets', () => {
    const source = [
      `useModelScopedLocalStorageManualReset('live2d', 'settings/live2d/scale', 1)`,
      `const legacy = { a: 'old/a', b: 'old/b' }`,
      `for (const key of Object.values(legacy)) localStorage.removeItem(key)`,
      `function setting(key: string) { return useLocalStorage(key, 1) }`,
      `setting('feed/speed')`,
    ].join('\n')

    expect(keysOf(source)).toEqual([
      { perModel: 'settings/live2d/scale' },
      { exact: 'old/a' },
      { exact: 'old/b' },
      { exact: 'feed/speed' },
    ])
  })

  it('resolves a name through its scope, so a parameter or loop variable hides a same-named constant', () => {
    const source = [
      `const key = 'settings/example/a'`,
      `function save(key: string) { localStorage.setItem(key, '1') }`,
      `save(makeKey())`,
      `function other() { const id = 'settings/example/b'; useLocalStorage(id, 1) }`,
      `for (const id of keys()) localStorage.removeItem(id)`,
      `useLocalStorage(key, 1)`,
    ].join('\n')

    expect(keysOf(source)).toEqual([
      { unresolved: 'key' },
      { exact: 'settings/example/b' },
      { unresolved: 'id' },
      { exact: 'settings/example/a' },
    ])
  })

  it('scans the script blocks of a `.vue` file with their line numbers', () => {
    const source = [
      '<template><div /></template>',
      '<script setup lang="ts">',
      `const mode = useLocalStorage('ui/chat/send-mode', 'enter')`,
      '</script>',
    ].join('\n')

    expect(findStorageWrites('packages/ui/src/example.vue', source)).toEqual([
      { file: 'packages/ui/src/example.vue', line: 3, area: 'localStorage', operation: 'write', key: { exact: 'ui/chat/send-mode' } },
    ])
  })

  it('reports a key it cannot resolve with its expression', () => {
    expect(keysOf(`sessionStorage.setItem(makeKey(), '1')`)).toEqual([{ unresolved: 'makeKey()' }])
  })
})

describe('checkStorageWrites', () => {
  const registry: RegistrySource[] = [{
    id: 'example',
    tier: 1,
    writers: [file],
    locations: [
      { area: 'localStorage', key: 'settings/example/a' },
      { area: 'localStorage', key: 'settings/example/old', legacy: true },
    ],
  }]
  const check = (source: string, path = file) => checkStorageWrites(findStorageWrites(path, source), registry, [])

  it('accepts a write of a registered key from one of its writers, and removing a legacy key', () => {
    expect(check(`localStorage.setItem('settings/example/a', '1')\nlocalStorage.removeItem('settings/example/old')`)).toEqual([])
  })

  it('fails on an unregistered key, a legacy write, and a write from a file outside `writers`', () => {
    expect(check(`localStorage.setItem('settings/example/unowned', '1')`)[0]).toContain(`'settings/example/unowned' matches no registration`)
    expect(check(`localStorage.setItem('settings/example/old', '1')`)[0]).toContain('matches a legacy location of example')
    expect(check(`localStorage.setItem('settings/example/a', '1')`, 'packages/stage-ui/src/other.ts')[0]).toContain('is not one of its writers')
  })

  it('fails on an unresolved site unless a dynamic site entry names its file and registration', () => {
    const sites = findStorageWrites(file, `localStorage.setItem(makeKey(), '1')`)

    expect(checkStorageWrites(sites, registry, [])[0]).toContain('unresolved key `makeKey()` matches no registration')
    expect(checkStorageWrites(sites, registry, [{ file, registration: 'example', reason: 'test' }])).toEqual([])
  })
})

describe('readStateRegistry', () => {
  it('reads literal registrations and rejects a computed location', () => {
    const registration = (location: string) => `export const stateRegistry = defineStateRegistry([{ id: 'a', owner: 'x', writers: ['w.ts'], tier: 1, locations: [${location}] }])`

    expect(readStateRegistry(registration(`{ area: 'localStorage', key: 'k', legacy: true }`))).toEqual([
      { id: 'a', tier: 1, writers: ['w.ts'], locations: [{ area: 'localStorage', key: 'k', legacy: true }] },
    ])
    expect(() => readStateRegistry(registration(`{ area: 'localStorage', key: KEY }`))).toThrow('is not a literal')
  })
})

describe('persistence ownership', () => {
  const upstream: RegistrySource = {
    id: 'upstream-settings',
    tier: 'plain',
    upstream: 'bd4f30391',
    writers: [file],
    locations: [{ area: 'localStorage', key: 'settings/example/enabled' }],
  }

  it('rejects fork plain state and open upstream prefixes', () => {
    expect(checkStorageWrites([], [{ ...upstream, upstream: undefined }], [])[0]).toContain('new fork state')
    expect(checkStorageWrites([], [{ ...upstream, upstream: undefined, exception: 'Fork state awaiting S2 migration' }], [])[0]).toContain('new fork state')
    expect(checkStorageWrites([], [{ ...upstream, locations: [{ area: 'localStorage', prefix: 'settings/example/' }] }], [])[0]).toContain('not an open prefix')
    expect(checkStorageWrites([], [{ ...upstream, upstream: 'main' }], [])[0]).toContain('pinned source revision')
  })

  it('rejects an extra key, an undeclared writer, and overlapping owners', () => {
    expect(checkStorageWrites(findStorageWrites(file, `useLocalStorage('settings/example/extra', true)`), [upstream], [])[0]).toContain('matches no registration')
    expect(checkStorageWrites(findStorageWrites('other.ts', `useLocalStorage('settings/example/enabled', true)`), [upstream], [])[0]).toContain('not one of its writers')
    expect(checkStorageWrites([], [upstream, { ...upstream, id: 'other' }], [])[0]).toContain('overlapping storage owners')
  })

  it('accepts legacy per-model removals and rejects both helper and literal writes', () => {
    const registry = [{
      id: 'retired',
      tier: 'plain',
      exception: 'Legacy sweep only',
      writers: [file],
      locations: [{ area: 'localStorage', perModel: 'settings/example/old', legacy: true }],
    }]
    for (const key of [`modelScopedStorageKey(modelId, 'settings/example/old')`, `'settings/models/model-a/example/old'`, `'settings/example/old'`]) {
      expect(checkStorageWrites(findStorageWrites(file, `localStorage.removeItem(${key})`), registry, [])).toEqual([])
      expect(checkStorageWrites(findStorageWrites(file, `localStorage.setItem(${key}, 'true')`), registry, [])[0]).toContain('matches a legacy location')
    }
  })

  it('bounds dynamic factory keys to their declared members', () => {
    const dynamic = [{ file, registration: upstream.id, reason: 'Synthetic parameterized factory.' }]
    const accepted = findStorageWrites(file, `useLocalStorage(\`settings/\${moduleName}/enabled\`, true)`)
    const unknown = findStorageWrites(file, `useLocalStorage(\`settings/\${moduleName}/extra\`, true)`)
    expect(checkStorageWrites(accepted, [upstream], dynamic)).toEqual([])
    expect(checkStorageWrites(unknown, [upstream], dynamic)[0]).toContain('no declared member')
    expect(checkStorageWrites(findStorageWrites(file, `useLocalStorage('settings/example/extra', true)`), [upstream], dynamic)[0]).toContain('matches no registration')
  })

  it('resolves direct-command template parameters through their callers', () => {
    const source = `function save(key: string) { localStorage.setItem(\`settings/example/\${key}\`, 'true') }\nsave('enabled')\nsave('extra')`
    expect(keysOf(source)).toEqual([{ exact: 'settings/example/enabled' }, { exact: 'settings/example/extra' }])
    expect(checkStorageWrites(findStorageWrites(file, source), [upstream], [])[0]).toContain('matches no registration')
  })

  it('reads ownership and legacy per-model flags from the single registration point', () => {
    const source = `defineStateRegistry([{ id: 'old', tier: 'plain', upstream: 'bd4f30391', writers: ['writer.ts'], locations: [{ area: 'localStorage', perModel: 'settings/example/old', legacy: true }] }])`
    expect(readStateRegistry(source)).toEqual([{
      id: 'old',
      tier: 'plain',
      upstream: 'bd4f30391',
      writers: ['writer.ts'],
      locations: [{ area: 'localStorage', perModel: 'settings/example/old', legacy: true }],
    }])
  })
})
