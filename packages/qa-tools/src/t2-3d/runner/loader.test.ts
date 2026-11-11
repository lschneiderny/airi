import process from 'node:process'

import { expect, it } from 'vitest'

import { loadHeadlessMMD } from './loader'

it.runIf(process.env.AIRI_QA_MMD_MODEL)('loads the external PMX skeleton with Ammo and no image runtime', async () => {
  const path = process.env.AIRI_QA_MMD_MODEL
  if (!path)
    throw new Error('AIRI_QA_MMD_MODEL is required')
  const loaded = await loadHeadlessMMD(path)
  try {
    expect(loaded.assetSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(loaded.mmd.mesh.skeleton.bones.length).toBe(loaded.mmd.pmx.bones.length)
    expect(loaded.mmd.physics?.affectsIK).toBe(true)
    expect(loaded.textureRequests).toBeGreaterThan(0)
    loaded.mmd.update(1 / 60)
    expect(loaded.mmd.mesh.skeleton.bones.every(bone => bone.position.toArray().every(Number.isFinite))).toBe(true)
  }
  finally {
    loaded.dispose()
  }
}, 30_000)
