import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runInThisContext } from 'node:vm'

interface CubismCoreGlobal {
  Live2DCubismCore?: { Version: { csmGetVersion: () => number, csmGetLatestMocVersion: () => number } }
  __dirname?: string
  window?: unknown
}

const coreGlobal = globalThis as typeof globalThis & CubismCoreGlobal

/** Where `apps/stage-tamagotchi` keeps the core; it is gitignored and absent from fresh worktrees. */
export const defaultCorePath = join(import.meta.dirname, '../../../../apps/stage-tamagotchi/public/assets/js/CubismSdkForWeb-5-r.3/Core/live2dcubismcore.min.js')

/** The asm.js module finishes initializing after the script's own macrotask; a few yields suffice. */
const maxReadyYields = 100

function formatCoreVersion(version: number) {
  return `${version >>> 24}.${(version >>> 16) & 0xFF}.${version & 0xFFFF}`
}

/**
 * Evaluates the Cubism core in this Node process with no `window` and no WebGL, and waits until
 * its asm.js module answers `csmGetVersion`. Returns the global shims it had to install.
 */
export async function loadCubismCoreInNode(corePath: string) {
  if (!existsSync(corePath))
    throw new Error(`Cubism core not found: ${corePath}. Set AIRI_QA_CUBISM_CORE to a local live2dcubismcore.min.js.`)
  const shims: string[] = []
  if (coreGlobal.__dirname === undefined) {
    // NOTICE:
    // The core's Emscripten loader takes its Node branch, which evaluates `__dirname + "/"`.
    // In an ES module process the global scope has no CommonJS `__dirname`, so it throws.
    // Source: live2dcubismcore.min.js line 9, Cubism SDK for Web 5-r.3.
    // Removal condition: the core is loaded through a CommonJS wrapper that provides `__dirname`.
    coreGlobal.__dirname = dirname(corePath)
    shims.push('globalThis.__dirname')
  }
  runInThisContext(readFileSync(corePath, 'utf8'), { filename: corePath })

  for (let yields = 0; ; yields++) {
    try {
      const core = coreGlobal.Live2DCubismCore!
      return {
        version: formatCoreVersion(core.Version.csmGetVersion()),
        latestMocVersion: core.Version.csmGetLatestMocVersion(),
        readyAfterYields: yields,
        shims,
      }
    }
    catch (error) {
      if (yields >= maxReadyYields)
        throw new Error(`Cubism core did not initialize after ${maxReadyYields} macrotask yields`, { cause: error })
      await new Promise(resolve => setImmediate(resolve))
    }
  }
}

/**
 * Lets `pixi-live2d-display/cubism4` import in Node. Returns the shim it installed, if any.
 */
export function installWindowShim() {
  if (coreGlobal.window !== undefined)
    return []
  // NOTICE:
  // pixi-live2d-display reads `window.Live2DCubismCore` at module top level, which throws in
  // Node. Aliasing `window` to `globalThis` lets the check find the loaded core; the model
  // update path never reads `window`.
  // Source: pixi-live2d-display 0.4.0 dist/cubism4.es.js:5188.
  // Removal condition: the module guards the check with `typeof window`.
  coreGlobal.window = globalThis
  return ['globalThis.window = globalThis']
}
