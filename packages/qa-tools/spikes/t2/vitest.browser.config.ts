/**
 * Spike-only Vitest browser config: runs `parity.browser.test.ts` in headless Chromium.
 *
 * Usage (from packages/qa-tools):
 *   T2_SPIKE_OUT=<file.json> vitest run --config spikes/t2/vitest.browser.config.ts
 *
 * Inputs: AIRI_QA_RIG_FORBOOTH (rig folder), AIRI_QA_CUBISM_CORE (optional core path).
 * The core is served from its own folder as Vite's public directory and loaded with a script tag,
 * like apps/stage-web/src/test/setup-live2d.browser.ts. Rig bytes cross from Node through commands.
 */
import type { BrowserCommand } from 'vitest/node'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { withCpuSlots } from '@proj-airi/cpu-slots/vitest'
import { defineConfig } from 'vitest/config'

import { defaultCorePath } from './core-node'
import { readRig } from './rig'

const corePath = process.env.AIRI_QA_CUBISM_CORE ?? defaultCorePath
const fromLive2d = createRequire(join(import.meta.dirname, '../../../stage-ui-live2d/package.json'))
// qa-tools depends on neither pixi-live2d-display nor the Playwright provider; both resolve through
// stage-ui-live2d so the spike adds no dependency. The `import` condition targets dist/cubism4.es.js.
const cubism4EsPath = join(dirname(fromLive2d.resolve('pixi-live2d-display/cubism4')), 'cubism4.es.js')
const { playwright } = await import(pathToFileURL(fromLive2d.resolve('@vitest/browser-playwright')).href) as typeof import('@vitest/browser-playwright')

const t2CoreUrl: BrowserCommand<[]> = () => `/${basename(corePath)}`

const t2ReadRig: BrowserCommand<[]> = () => {
  const rig = readRig(process.env.AIRI_QA_RIG_FORBOOTH)
  return {
    modelUrl: rig.modelUrl,
    modelJson: rig.modelJson,
    mocBase64: Buffer.from(rig.moc).toString('base64'),
    physicsJson: rig.physicsJson,
    poseJson: rig.poseJson,
  }
}

const t2WriteResult: BrowserCommand<[json: string]> = (_context, json) => {
  const out = process.env.T2_SPIKE_OUT
  if (!out)
    throw new Error('T2_SPIKE_OUT is not set')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, json)
  return out
}

export default withCpuSlots(defineConfig({
  root: import.meta.dirname,
  publicDir: dirname(corePath),
  cacheDir: join(import.meta.dirname, '../../../../.temp/qa/t2-spike/vite-cache'),
  resolve: {
    alias: [{ find: /^pixi-live2d-display\/cubism4$/, replacement: cubism4EsPath }],
  },
  test: {
    name: 't2-spike-browser',
    include: ['parity.browser.test.ts'],
    testTimeout: 120_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      commands: { t2CoreUrl, t2ReadRig, t2WriteResult },
    },
  },
}))
