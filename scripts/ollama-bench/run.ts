import process from 'node:process'

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join, resolve } from 'node:path'

const usage = 'usage: bun run.ts [--out <dir>] [--no-sweep] <model> [<model>...]'
const args = Bun.argv.slice(2)
let out = resolve(import.meta.dir, 'results', `${new Date().toISOString().slice(0, 10)}-${hostname().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)
let sweep = true
const models: string[] = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out')
    out = resolve(args[++i] ?? '')
  else if (args[i] === '--no-sweep')
    sweep = false
  else
    models.push(args[i]!)
}
if (!models.length) {
  console.error(usage)
  process.exit(2)
}
mkdirSync(out, { recursive: true })

if (process.platform === 'darwin')
  Bun.spawn(['caffeinate', '-i', '-w', String(process.pid)]).unref()

async function ollama(...cmd: string[]) {
  const proc = Bun.spawn(['ollama', ...cmd], { stdout: 'pipe', stderr: 'pipe' })
  const text = await new Response(proc.stdout).text()
  const err = await new Response(proc.stderr).text()
  return { code: await proc.exited, text, err }
}

async function step(script: string, model: string, file: string) {
  const proc = Bun.spawn(['bun', join(import.meta.dir, script), model], { env: { ...process.env, OUT: join(out, file) }, stdout: 'inherit', stderr: 'inherit' })
  return proc.exited
}

const recorded = (file: string, model: string) => existsSync(join(out, file)) && readFileSync(join(out, file), 'utf8').includes(`"model":"${model}"`)

const installed = new Set((await ollama('list')).text.split('\n').slice(1).map(line => line.split(/\s+/)[0]).filter(Boolean))
console.info(`results: ${out}`)
for (const model of models) {
  const preinstalled = installed.has(model) || installed.has(`${model}:latest`)
  if (recorded('bench.jsonl', model) && (!sweep || recorded('sweep.jsonl', model))) {
    console.info(`ALREADY_DONE ${model}`)
    continue
  }
  console.info(`START ${model} ${new Date().toLocaleTimeString()}`)
  if (!preinstalled) {
    const pull = await ollama('pull', model)
    if (pull.code !== 0) {
      console.info(`PULL_FAILED ${model}: ${pull.err.trim().split('\n').at(-1)}`)
      continue
    }
  }
  if (!recorded('bench.jsonl', model))
    await step('bench.ts', model, 'bench.jsonl')
  if (sweep && !recorded('sweep.jsonl', model))
    await step('sweep.ts', model, 'sweep.jsonl')
  if (preinstalled) {
    console.info(`KEPT ${model} (was installed before the run)`)
  }
  else {
    const rm = await ollama('rm', model)
    console.info(rm.code === 0 ? `REMOVED ${model}` : `REMOVE_FAILED ${model}: ${rm.err.trim()}`)
  }
}
console.info(`ALL_DONE ${new Date().toLocaleTimeString()}`)
