import type { TestContext } from 'vitest'
import type { Locator } from 'vitest/browser'
import type { VNodeChild } from 'vue'

import { render } from 'vitest-browser-vue'
import { server } from 'vitest/browser'

import VisualBaselineFrame from './visual-baseline-frame.vue'

import '@unocss/reset/tailwind.css'
import '@fontsource-variable/dm-sans/index.css'
import 'virtual:uno.css'

/**
 * Platforms (`process.platform` of the Vitest server) whose reference images are committed.
 *
 * Text rasterization differs between operating systems, so each platform has its own references, named
 * `<name>-<browser>-<platform>.png`. On a listed platform a missing reference fails the test. On any other platform the
 * visual tests are reported as skipped, unless the run updates references (`--update`). Add a platform here in the same
 * commit as its first reviewed set of references.
 */
const referencePlatforms: ReadonlySet<string> = new Set(['linux'])

const fontFamily = 'DM Sans Variable'
const fontWeights = [400, 500, 600] as const

function skipWithoutReferences(context: TestContext): void {
  if (server.config.snapshotOptions.updateSnapshot === 'all' || referencePlatforms.has(server.platform))
    return

  context.skip(`no committed ${server.browser}-${server.platform} visual references; see packages/stage-ui/README.md#visual-baselines`)
}

async function waitForBundledFont(): Promise<void> {
  const loaded = await Promise.all(fontWeights.map(weight => document.fonts.load(`${weight} 16px "${fontFamily}"`)))
  // `load` resolves with no faces when no `@font-face` matches; the text would then use a platform font.
  if (loaded.some(faces => faces.length === 0))
    throw new Error(`The bundled "${fontFamily}" font did not load; visual baselines would depend on system fonts.`)

  await document.fonts.ready
}

/**
 * Renders `content` on the light and dark panels of the visual baseline frame and returns the frame locator for
 * `expect.element(frame).toMatchScreenshot(name)`.
 *
 * Skips the test on platforms without committed references. Every visual baseline test must render through this
 * function so that the platform policy applies to it.
 *
 * Use when:
 * - A deterministic component state needs a reference image.
 *
 * Expects:
 * - `content` has no animation, timer, network, or random input.
 * - UnoCSS classes and icons in `content` come from scanned `.vue` sources or the UnoCSS safelist.
 */
export async function renderVisualBaseline(
  context: TestContext,
  content: () => VNodeChild,
  options: { layout?: 'stack' | 'wrap' } = {},
): Promise<Locator> {
  skipWithoutReferences(context)

  const screen = render(VisualBaselineFrame, {
    props: { layout: options.layout },
    slots: { default: content },
  })
  await waitForBundledFont()

  return screen.getByTestId('visual-baseline')
}
