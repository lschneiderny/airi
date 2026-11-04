import process from 'node:process'

import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { checkEagerChunks } from './bundle-check-plan'

const rendererOut = resolve(import.meta.dirname, '../../apps/stage-tamagotchi/out/renderer')
const indexHtml = join(rendererOut, 'index.html')

async function readChunks(): Promise<Map<string, string>> {
  const chunks = new Map<string, string>()
  const files = (await readdir(join(rendererOut, 'assets'))).filter(file => file.endsWith('.js'))
  await Promise.all(files.map(async (file) => {
    chunks.set(`assets/${file}`, await readFile(join(rendererOut, 'assets', file), 'utf8'))
  }))
  return chunks
}

async function main() {
  if (!existsSync(indexHtml)) {
    console.error(`bundle-check: ${indexHtml} is missing. Run \`pnpm build:tamagotchi\` first.`)
    process.exit(1)
  }
  const chunks = await readChunks()
  const result = checkEagerChunks(await readFile(indexHtml, 'utf8'), chunks)
  const eagerBytes = result.eager.reduce((total, file) => total + Buffer.byteLength(chunks.get(file) ?? ''), 0)
  console.info(`bundle-check: the main window loads ${result.eager.length} chunks (${(eagerBytes / 1024 / 1024).toFixed(2)} MB) at startup.`)
  for (const file of result.heavy)
    console.error(`bundle-check: ${file} loads three at startup. Load the 3D code that needs it with a dynamic import().`)
  for (const file of result.missing)
    console.error(`bundle-check: ${file} is imported at startup but missing from the build output.`)
  if (result.heavy.length > 0 || result.missing.length > 0)
    process.exit(1)
  console.info('bundle-check: three, three-mmd, three-vrm, and Tres load only on demand.')
}

await main()
