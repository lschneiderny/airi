import process from 'node:process'

import { appendFileSync } from 'node:fs'

const OLLAMA = 'http://127.0.0.1:11434'
const OUT = process.env.OUT ?? 'bench.jsonl'
const model = Bun.argv[2]
if (!model)
  throw new Error('usage: bun bench.ts <model>')

const memoryIndex = await Bun.file(`${import.meta.dir}/inputs/memory-index.txt`).text()
const system = `${await Bun.file(`${import.meta.dir}/inputs/shuka-system-prompt.txt`).text()}\n\n${memoryIndex}`
const tools = [
  ...JSON.parse(await Bun.file(`${import.meta.dir}/inputs/tools.json`).text()),
  ...JSON.parse(await Bun.file(`${import.meta.dir}/inputs/memory-tools.json`).text()),
]
const toolResults: Record<string, string> = {
  builtIn_readMemory: '01932b4e-mem-presentation (yours): The owner\'s presentation is on Friday at 3pm.',
  builtIn_writeMemory: 'Saved memory "01932b4e-mem-presentation".',
}
const situation = '[Situation 23:40]\n- The user is at the desk and active\n- Now: Discord (chat), for about 10 min'
const script = [
  'hey',
  'i\'m kinda nervous about my presentation tomorrow',
  'remember that my presentation is on friday at 3pm',
  'tell me a joke to cheer me up',
  'what\'s the difference between a planet and a dwarf planet?',
  'brb gotta take a call',
  'ok i\'m back, did you miss me?',
  'when was my presentation again?',
]
const PROBES = 4
const TURN_TIMEOUT_MS = 300_000

const userMsg = (text: string, i: number) => ({ role: 'user', content: `[2026-10-26 23:${String(40 + i).padStart(2, '0')}] ${text}\n\n${situation}` })

async function unloadAll() {
  const ps = await (await fetch(`${OLLAMA}/api/ps`)).json()
  for (const m of ps.models ?? [])
    await fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model: m.name, keep_alive: 0 }) })
}

const show = await (await fetch(`${OLLAMA}/api/show`, { method: 'POST', body: JSON.stringify({ model }) })).json()
const caps: string[] = show.capabilities ?? []
const withTools = caps.includes('tools')
const thinking = caps.includes('thinking')

async function chat(messages: unknown[]) {
  const body: Record<string, unknown> = { model, messages, stream: true, options: { num_ctx: 8192 } }
  if (withTools)
    body.tools = tools
  if (thinking)
    body.think = false
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TURN_TIMEOUT_MS)
  const t0 = performance.now()
  let firstAt: number | null = null
  let text = ''
  let thinkingText = ''
  let toolCalls: unknown[] = []
  let finish: string | null = null
  let usage: Record<string, number> | null = null
  let error: string | null = null
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal })
    if (!res.ok) {
      error = `${res.status} ${await res.text()}`
    }
    else {
      const decoder = new TextDecoder()
      let buffer = ''
      const stream = res.body!
      const flushTail = { done: false }
      const withTrailingNewline = async function* () {
        yield* stream
        flushTail.done = true
        yield new Uint8Array([10])
      }
      for await (const chunk of withTrailingNewline()) {
        buffer += decoder.decode(chunk, { stream: !flushTail.done })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim())
            continue
          let ev
          try {
            ev = JSON.parse(line)
          }
          catch {
            error = `unparsed: ${line.slice(0, 300)}`
            continue
          }
          const msg = ev.message
          if (msg?.thinking)
            thinkingText += msg.thinking
          if (msg?.content || msg?.tool_calls?.length) {
            firstAt ??= performance.now()
            text += msg.content ?? ''
            if (msg.tool_calls?.length)
              toolCalls = toolCalls.concat(msg.tool_calls)
          }
          if (ev.error)
            error = String(ev.error)
          if (ev.done) {
            finish = ev.done_reason ?? 'stop'
            usage = { loadMs: Math.round((ev.load_duration ?? 0) / 1e6), promptTokens: ev.prompt_eval_count, promptMs: Math.round((ev.prompt_eval_duration ?? 0) / 1e6), evalTokens: ev.eval_count, evalMs: Math.round((ev.eval_duration ?? 0) / 1e6) }
          }
        }
      }
    }
  }
  catch (e) {
    error = String(e)
  }
  clearTimeout(timer)
  if (!error && finish === null)
    error = 'stream ended without a done event'
  return { ttftMs: firstAt === null ? null : Math.round(firstAt - t0), totalMs: Math.round(performance.now() - t0), text, thinkingText, toolCalls, finish, usage, error }
}

async function turnWithTools(messages: unknown[]) {
  const first = await chat(messages)
  let last = first
  const allTools = [...first.toolCalls]
  let steps = 1
  while (!last.error && last.toolCalls.length && !last.text.replace(/<\|[^|]*\|>/g, '').trim() && steps < 3) {
    messages.push({ role: 'assistant', content: last.text, tool_calls: last.toolCalls })
    for (const c of last.toolCalls as { function: { name: string } }[]) messages.push({ role: 'tool', tool_name: c.function.name, content: toolResults[c.function.name] ?? JSON.stringify({ success: true }) })
    last = await chat(messages)
    allTools.push(...last.toolCalls)
    steps++
  }
  return { ...last, ttftMs: first.ttftMs, usage: first.usage, lastUsage: last.usage, totalMs: first.totalMs + (last === first ? 0 : last.totalMs), toolCalls: allTools, steps }
}

async function psInfo() {
  const ps = await (await fetch(`${OLLAMA}/api/ps`)).json()
  const m = ps.models?.find((x: { name: string }) => x.name === model || x.name === `${model}:latest`)
  return m ? { sizeBytes: m.size, vramBytes: m.size_vram, ctx: m.context_length } : null
}

await unloadAll()
const sysFree = process.platform === 'darwin'
  ? Number((await Bun.$`memory_pressure -Q`.nothrow().quiet()).stdout.toString().match(/(\d+)%/)?.[1] ?? Number.NaN)
  : null
const turns: Array<{ error: string | null, text: string }> = []
let firstLoadError: string | null = null
const messages: unknown[] = [{ role: 'system', content: system }]
for (const [i, t] of script.entries()) {
  messages.push(userMsg(t, i))
  let r = await turnWithTools(messages)
  if (i === 0 && r.error && !r.text) {
    firstLoadError = r.error
    console.info(`${model} turn 1 failed (${r.error}); retrying once`)
    r = await turnWithTools(messages)
  }
  turns.push({ turn: i + 1, user: t, ...r, ps: await psInfo() })
  console.info(`${model} turn ${i + 1}: ttft=${r.ttftMs} total=${r.totalMs} finish=${r.finish} err=${r.error?.slice(0, 80) ?? ''}`)
  if (r.error && !r.text)
    break
  messages.push({ role: 'assistant', content: r.text })
}
const probes: unknown[] = []
if (!turns.some(t => t.error && !t.text)) {
  for (let k = 0; k < PROBES; k++) {
    const r = await turnWithTools([{ role: 'system', content: system }, userMsg('hey', 0)])
    probes.push(r)
    console.info(`${model} probe ${k + 1}: ttft=${r.ttftMs} err=${r.error?.slice(0, 60) ?? ''}`)
  }
}
const ps = await psInfo()
appendFileSync(OUT, `${JSON.stringify({ model, caps, withTools, thinking, memFreePctAtStart: sysFree, firstLoadError, ps, turns, probes })}\n`)
await unloadAll()
console.info(`BENCH_DONE ${model}`)
