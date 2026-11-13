import { describe, expect, it } from 'vitest'

import { chunkByLength, nodeCommandChunkLimitsFor, shimCommandChunkLimits } from './exec'

describe('chunkByLength', () => {
  it('splits by item count', () => {
    expect(chunkByLength(['a', 'b', 'c'], { maxItems: 2, maxLength: 1000 })).toEqual([['a', 'b'], ['c']])
  })

  it('counts a separator and a pair of quotes per item against the length limit', () => {
    const items = ['aaaa', 'bbbb', 'cccc']
    // Each item costs its length plus 3: 7, so two items need 14 and do not fit in 13.
    expect(chunkByLength(items, { maxItems: 10, maxLength: 13 })).toEqual([['aaaa'], ['bbbb'], ['cccc']])
  })

  it('keeps an item longer than the limit alone in its own chunk', () => {
    expect(chunkByLength(['a', 'x'.repeat(50), 'b'], { maxItems: 10, maxLength: 10 })).toEqual([['a'], ['x'.repeat(50)], ['b']])
  })

  it('returns no chunks for no items', () => {
    expect(chunkByLength([], { maxItems: 2, maxLength: 10 })).toEqual([])
  })

  it('keeps every chunk of a long path list under the limit', () => {
    const items = Array.from({ length: 2000 }, (_, index) => `packages/some/deeply/nested/directory/file-${index}.ts`)
    const chunks = chunkByLength(items, { maxItems: 150, maxLength: 4000 })
    expect(chunks.flat()).toEqual(items)
    for (const files of chunks)
      expect(files.reduce((sum, file) => sum + file.length + 3, 0)).toBeLessThanOrEqual(4000)
  })

  it('keeps a shimmed command under the cmd.exe limit even for deep paths', () => {
    const items = Array.from({ length: 1500 }, (_, index) => `apps/stage-tamagotchi-kirie/src-web/src/renderer/widgets/extension-ui/composables/file-${index}.test.ts`)
    for (const files of chunkByLength(items, shimCommandChunkLimits))
      expect(files.reduce((sum, file) => sum + file.length + 3, 0)).toBeLessThan(8191 - 500)
    expect(nodeCommandChunkLimitsFor('win32').maxLength).toBeLessThan(32767)
  })
})

describe('nodeCommandChunkLimitsFor', () => {
  // 400 changed files with paths of about 100 characters: a branch-sized change set.
  const files = Array.from({ length: 400 }, (_, index) => `/home/dev/projects/airi/packages/stage-ui/src/components/scenarios/settings/model-settings/file-${index}.ts`)

  it('keeps a branch-sized file list in one command where the system has no short command-line limit', () => {
    expect(chunkByLength(files, nodeCommandChunkLimitsFor('linux'))).toHaveLength(1)
    expect(chunkByLength(files, nodeCommandChunkLimitsFor('darwin'))).toHaveLength(1)
  })

  it('still splits the same list under the CreateProcess limit on Windows', () => {
    expect(chunkByLength(files, nodeCommandChunkLimitsFor('win32')).length).toBeGreaterThan(1)
  })
})
