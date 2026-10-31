import process from 'node:process'

import { execFile } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const packageUrl = new URL('../../../', import.meta.url)
const toPath = (url: string | URL) => fileURLToPath(url).replaceAll('\\', '/')
const naturalModules = readdirSync(new URL('./natural-motion/', import.meta.url))
  .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'))
  .map(file => file.slice(0, -'.ts'.length))
/** Subpath export -> the source file it must resolve to. The wildcard is checked for every module it exposes. */
const subpaths: Record<string, string> = {
  'composables/live2d/natural-motion-adapter': 'src/composables/live2d/natural-motion-adapter.ts',
  'composables/live2d/expression/compose': 'src/composables/live2d/expression/compose.ts',
  'composables/live2d/expression/hold': 'src/composables/live2d/expression/hold.ts',
  'composables/live2d/expression/slots': 'src/composables/live2d/expression/slots.ts',
  'stores/expression-slot-leases': 'src/stores/expression-slot-leases.ts',
  ...Object.fromEntries(naturalModules.map(name => [`composables/live2d/natural-motion/${name}`, `src/composables/live2d/natural-motion/${name}.ts`])),
}

// Runs in a separate Node process, so the package's own export map resolves the self-references
// and the module graph is plain Node: no Vite plugins, no DOM, no `window`.
const probe = `
import { registerHooks } from 'node:module'
const resolved = []
registerHooks({ resolve(specifier, context, nextResolve) { const result = nextResolve(specifier, context); resolved.push(result.url); return result } })
const failures = []
for (const subpath of JSON.parse(process.argv[1])) {
  try { await import('@proj-airi/stage-ui-live2d/' + subpath) }
  catch (error) { failures.push(subpath + ': ' + error.message) }
}
process.stdout.write(JSON.stringify({ failures, resolved, window: typeof window }))
`

describe('node-safe subpath exports', () => {
  it('imports every Natural subpath in plain Node without pixi, Vue files, or window', async () => {
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', probe, JSON.stringify(Object.keys(subpaths))], { cwd: fileURLToPath(packageUrl) })
    const result = JSON.parse(stdout) as { failures: string[], resolved: string[], window: string }
    const files = result.resolved.filter(url => url.startsWith('file:')).map(toPath)

    expect(result.failures).toEqual([])
    expect(result.window).toBe('undefined')
    expect(files.filter(file => /pixi|\.vue$/i.test(file))).toEqual([])
    for (const target of Object.values(subpaths))
      expect(files).toContain(toPath(new URL(target, packageUrl)))
  }, 60_000)
})
