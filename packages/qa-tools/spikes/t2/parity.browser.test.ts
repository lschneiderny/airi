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

/** Upper bound for the core script's load event. */
const coreLoadTimeoutMs = 30_000

async function loadCore() {
  const src = await commands.t2CoreUrl()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // The core's Emscripten module initializes before the script's `load` event fires, so the
    // event is the readiness signal. The listener is attached before the script is inserted.
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        const script = document.createElement('script')
        script.src = src
        script.addEventListener('load', () => resolve(), { once: true })
        script.addEventListener('error', () => reject(new Error(`Failed to load the Cubism core from ${src}`)), { once: true })
        document.head.appendChild(script)
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Cubism core script did not fire load within ${coreLoadTimeoutMs} ms: ${src}`)), coreLoadTimeoutMs)
      }),
    ])
  }
  finally {
    clearTimeout(timer)
  }
  const core = (globalThis as typeof globalThis & { Live2DCubismCore: { Version: { csmGetVersion: () => number } } }).Live2DCubismCore
  return core.Version.csmGetVersion()
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
