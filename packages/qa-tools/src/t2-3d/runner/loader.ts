import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { MMDLoader } from '@moeru/three-mmd'
import { initAmmo, MMDAmmoPhysics } from '@moeru/three-mmd-physics-ammo'
import { LoadingManager, Texture, TextureLoader } from 'three'

/**
 * Loads external PMX bytes and the shipped Ammo backend without a DOM or GPU.
 * The returned handle owns physics, mesh resources and inert texture objects.
 */
export async function loadHeadlessMMD(path: string) {
  const bytes = await readFile(path)
  const textures: Texture[] = []
  const manager = new LoadingManager()
  // NOTICE:
  // Headless measurements omit images; image completion invokes DOM/canvas work.
  // three-mmd's loadTextureResource rotates toon images and inspects alpha.
  // Source: @moeru/three-mmd/dist/index.js, loadTextureResource.
  // Remove this boundary if this level begins judging materials or pixels.
  class HeadlessTextures extends TextureLoader {
    override load(): Texture<HTMLImageElement> {
      const texture = new Texture<HTMLImageElement>()
      textures.push(texture)
      return texture
    }
  }
  manager.addHandler(/.*/, new HeadlessTextures(manager))
  const progressDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ProgressEvent')
  // NOTICE:
  // Node lacks the ProgressEvent that Three's streamed FileLoader constructs.
  // Source: three/src/loaders/FileLoader.js, streamed fetch progress.
  // Remove when Node provides ProgressEvent or Three owns a Node transport.
  if (typeof globalThis.ProgressEvent === 'undefined') {
    class NodeProgressEvent extends Event {
      readonly lengthComputable: boolean
      readonly loaded: number
      readonly total: number

      constructor(type: string, init: ProgressEventInit = {}) {
        super(type, init)
        this.lengthComputable = init.lengthComputable ?? false
        this.loaded = init.loaded ?? 0
        this.total = init.total ?? 0
      }
    }
    Object.defineProperty(globalThis, 'ProgressEvent', { value: NodeProgressEvent, configurable: true })
  }
  try {
    const mmd = await new MMDLoader(manager).loadAsync(`data:application/octet-stream;base64,${bytes.toString('base64')}`)
    const dispose = () => {
      mmd.dispose()
      mmd.mesh.geometry.dispose()
      const materials = Array.isArray(mmd.mesh.material) ? mmd.mesh.material : [mmd.mesh.material]
      materials.forEach(material => material.dispose())
      mmd.mesh.skeleton.dispose()
      textures.forEach(texture => texture.dispose())
    }
    try {
      await initAmmo()
      mmd.setPhysics(MMDAmmoPhysics)
    }
    catch (error) {
      dispose()
      throw error
    }
    return {
      mmd,
      assetSha256: createHash('sha256').update(bytes).digest('hex'),
      textureRequests: textures.length,
      dispose,
    }
  }
  finally {
    if (progressDescriptor)
      Object.defineProperty(globalThis, 'ProgressEvent', progressDescriptor)
    else
      Reflect.deleteProperty(globalThis, 'ProgressEvent')
  }
}
