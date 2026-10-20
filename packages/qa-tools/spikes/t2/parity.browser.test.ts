import type { Cubism4Module, T2RigData } from './loop'

import { expect, it } from 'vitest'
import { commands } from 'vitest/browser'

import { runT2Loop } from './loop'

declare module 'vitest/browser' {
  interface BrowserCommands {
    t2CoreUrl: () => Promise<string>
    t2ReadRig: () => Promise<Omit<T2RigData, 'moc'> & { mocBase64: string }>
    t2WriteResult: (json: string) => Promise<string>
  }
}

/** The core's asm.js module finishes initializing after its script task, as in Node. */
const maxReadyYields = 100

async function loadCore() {
  const src = await commands.t2CoreUrl()
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => reject(new Error(`Failed to load the Cubism core from ${src}`)), { once: true })
    document.head.appendChild(script)
  })
  const core = (globalThis as typeof globalThis & { Live2DCubismCore: { Version: { csmGetVersion: () => number } } }).Live2DCubismCore
  for (let yields = 0; ; yields++) {
    try {
      return core.Version.csmGetVersion()
    }
    catch (error) {
      if (yields >= maxReadyYields)
        throw new Error('Cubism core did not initialize', { cause: error })
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }
}

it('runs the T2 loop on the real core in headless Chromium', async () => {
  const version = await loadCore()
  // Imported after the core: the module checks `window.Live2DCubismCore` at top level.
  const cubism4 = await import('pixi-live2d-display/cubism4') as unknown as Cubism4Module
  const { mocBase64, ...wire } = await commands.t2ReadRig()
  const moc = Uint8Array.from(atob(mocBase64), char => char.charCodeAt(0)).buffer

  const result = runT2Loop(cubism4, { ...wire, moc }, { frames: 600, dt: 1 / 60, seed: 1, physics: true, recordParameters: true, deform: true, profile: false })
  expect(result.frames).toHaveLength(600)

  await commands.t2WriteResult(JSON.stringify({
    side: 'browser',
    userAgent: navigator.userAgent,
    coreVersion: version,
    physics: true,
    deform: true,
    seed: 1,
    dt: 1 / 60,
    loopMs: result.loopMs,
    parameterIds: result.parameterIds,
    frames: result.frames,
    trace: result.trace,
  }))
})
