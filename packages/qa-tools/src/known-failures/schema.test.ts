import { describe, expect, it } from 'vitest'

import { parseKnownFailureRegistry } from './schema'

const entry = {
  package: '@proj-airi/stage-shared',
  project: 'default',
  file: 'src/a.test.ts',
  name: 'suite > test',
  reason: 'localStorage is undefined in the node project',
  since: '2026-10-20',
  removeWhen: 'the test runs in a browser project or provides storage',
}

function registryText(entries: unknown[]) {
  return JSON.stringify({ version: 1, entries })
}

describe('parseKnownFailureRegistry', () => {
  it('accepts a valid registry with an optional flaky marker', () => {
    const registry = parseKnownFailureRegistry(registryText([entry, { ...entry, name: 'suite > other', flaky: true }]), 'reg.json')

    expect(registry.entries).toHaveLength(2)
    expect(registry.entries[1].flaky).toBe(true)
  })

  it('rejects an entry without a reason and names the path', () => {
    const { reason: _reason, ...withoutReason } = entry

    expect(() => parseKnownFailureRegistry(registryText([withoutReason]), 'reg.json')).toThrow(/entries\.0\.reason/)
  })

  it('rejects a blank reason', () => {
    expect(() => parseKnownFailureRegistry(registryText([{ ...entry, reason: '   ' }]), 'reg.json')).toThrow(/entries\.0\.reason/)
  })

  it('rejects unknown fields, bad dates, unknown projects and flaky: false', () => {
    expect(() => parseKnownFailureRegistry(registryText([{ ...entry, extra: 1 }]), 'reg.json')).toThrow(/entries\.0\.extra/)
    expect(() => parseKnownFailureRegistry(registryText([{ ...entry, since: '20.10.2026' }]), 'reg.json')).toThrow(/entries\.0\.since/)
    expect(() => parseKnownFailureRegistry(registryText([{ ...entry, project: 'gate' }]), 'reg.json')).toThrow(/entries\.0\.project/)
    expect(() => parseKnownFailureRegistry(registryText([{ ...entry, flaky: false }]), 'reg.json')).toThrow(/entries\.0\.flaky/)
  })

  it('rejects another version and duplicate keys', () => {
    expect(() => parseKnownFailureRegistry(JSON.stringify({ version: 2, entries: [] }), 'reg.json')).toThrow(/version/)
    expect(() => parseKnownFailureRegistry(registryText([entry, { ...entry, reason: 'again' }]), 'reg.json')).toThrow(/more than once/)
  })

  it('reports corrupt JSON with the file name', () => {
    expect(() => parseKnownFailureRegistry('{ "version": 1, "entries": [', 'C:/tmp/reg.json')).toThrow(/C:\/tmp\/reg\.json is not valid JSON/)
  })
})
