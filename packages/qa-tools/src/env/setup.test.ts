import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { setupCubism } from './setup'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

describe('setupCubism', () => {
  it('downloads both missing app copies, skips present copies, and replaces them with force', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qa-setup-'))
    roots.push(root)
    const downloads: string[] = []
    const download = async (appRoot: string) => {
      downloads.push(appRoot)
      const core = join(appRoot, 'public/assets/js/CubismSdkForWeb-5-r.3/Core/live2dcubismcore.min.js')
      const cache = join(appRoot, '.cache/assets/js/CubismSdkForWeb-5-r.3')
      expect(existsSync(core)).toBe(false)
      expect(existsSync(cache)).toBe(false)
      mkdirSync(dirname(core), { recursive: true })
      mkdirSync(cache, { recursive: true })
      writeFileSync(core, `download ${downloads.length}`)
    }

    expect(await setupCubism(root, false, download)).toEqual([
      'downloaded apps/stage-tamagotchi',
      'downloaded apps/stage-web',
    ])
    expect(existsSync(join(root, 'apps/stage-web/public/assets/js/CubismSdkForWeb-5-r.3/Core/live2dcubismcore.min.js'))).toBe(true)
    expect(await setupCubism(root, false, download)).toEqual([
      'skip apps/stage-tamagotchi: Cubism Core already exists',
      'skip apps/stage-web: Cubism Core already exists',
    ])
    expect(downloads).toHaveLength(2)
    await setupCubism(root, true, download)
    expect(downloads).toEqual([
      join(root, 'apps/stage-tamagotchi'),
      join(root, 'apps/stage-web'),
      join(root, 'apps/stage-tamagotchi'),
      join(root, 'apps/stage-web'),
    ])
  })
})
