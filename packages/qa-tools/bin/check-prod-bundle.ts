import { resolve } from 'node:path'
import { argv, exit, stderr, stdout } from 'node:process'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

import { motionQaBundleMarkers, scanBundle } from '../src/prod-bundle/check'

const usage = `Usage: pnpm -F @proj-airi/qa-tools exec tsx bin/check-prod-bundle.ts [directory]

Scans the .js files under [directory] (default: apps/stage-tamagotchi/out/renderer) for the dev-only motion QA
bridge markers: ${motionQaBundleMarkers.join(', ')}.
Exits 0 when no marker is found, 1 when any is found, and 2 when the directory is missing or holds no .js files.
`

let positionals: string[]
try {
  const parsed = parseArgs({ args: argv.slice(2), options: { help: { type: 'boolean', short: 'h' } }, allowPositionals: true, strict: true })
  if (parsed.values.help) {
    stdout.write(usage)
    exit(0)
  }
  positionals = parsed.positionals
}
catch (error) {
  stderr.write(`check-prod-bundle: ${errorMessageFrom(error) ?? 'invalid arguments'}\n\n${usage}`)
  exit(2)
}

async function main(root: string) {
  const { files, leaks } = await scanBundle(root)
  if (files === 0) {
    stderr.write(`check-prod-bundle: no .js files under ${root}; build the app first\n`)
    exit(2)
  }
  stdout.write(`scanned ${files} .js files under ${root}\n`)
  for (const leak of leaks)
    stdout.write(`LEAK ${leak.marker} in ${leak.file} at offset ${leak.offset}: ${JSON.stringify(leak.excerpt)}\n`)
  stdout.write(leaks.length === 0 ? 'no motion QA bridge markers found\n' : `${leaks.length} motion QA bridge marker(s) found\n`)
  exit(leaks.length === 0 ? 0 : 1)
}

const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
main(positionals[0] ? resolve(positionals[0]) : resolve(repoRoot, 'apps', 'stage-tamagotchi', 'out', 'renderer')).catch((error) => {
  stderr.write(`check-prod-bundle: ${errorMessageFrom(error) ?? 'scan failed'}\n`)
  exit(2)
})
