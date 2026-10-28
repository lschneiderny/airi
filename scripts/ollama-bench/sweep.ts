import process from 'node:process'

import { appendFileSync } from 'node:fs'

const OLLAMA = 'http://127.0.0.1:11434'
const OUT = process.env.OUT ?? 'sweep.jsonl'
const model = Bun.argv[2]
if (!model)
  throw new Error('usage: bun sweep.ts <model>')

const system = await Bun.file(`${import.meta.dir}/inputs/shuka-system-prompt.txt`).text()
const tools = JSON.parse(await Bun.file(`${import.meta.dir}/inputs/tools.json`).text())
const situation = '[Situation 23:40]\n- The user is at the desk and active\n- Now: Discord (chat), for about 10 min'
const script = [
  'hey',
  'i\'m kinda nervous about my presentation tomorrow',
  'what\'s the difference between a planet and a dwarf planet?',
  'brb gotta take a call',
]
const PROBES = 3
const TURN_TIMEOUT_MS = 300_000

const show = await (await fetch(`${OLLAMA}/api/show`, { method: 'POST', body: JSON.stringify({ model }) })).json()
const caps: string[] = show.capabilities ?? []
const withTools = caps.includes('tools')
const thinkingCap = caps.includes('thinking')

const configs: { name: string, options: Record<string, number>, think: boolean }[] = [
  { name: 'defaults', options: {}, think: false },
  { name: 'temp-0.6', options: { temperature: 0.6 }, think: false },
  { name: 'temp-1.0-minp-0.05', options: { temperature: 1.0, min_p: 0.05 }, think: false },
  { name: 'repeat-1.15', options: { repeat_penalty: 1.15 }, think: false },
  ...(thinkingCap ? [{ name: 'think-on', options: {}, think: true }] : []),
]

const userMsg = (text: string, i: number) => ({ role: 'user', content: `[2026-10-26 23:${String(40 + i).padStart(2, '0')}] ${text}\n\n${situation}` })

async function chat(messages: unknown[], options: Record<string, number>, think: boolean) {
  const body: Record<string, unknown> = { model, messages, stream: true, options: { num_ctx: 8192, ...options } }
  if (withTools)
    body.tools = tools
  if (thinkingCap)
    body.think = think
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
    const raw = await res.text()
    if (!res.ok)
      error = `${res.status} ${raw.slice(0, 300)}`
    for (const line of raw.split('\n')) {
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
    firstAt = performance.now()
  }
  catch (e) {
    error = String(e)
  }
  clearTimeout(timer)
  if (!error && finish === null)
    error = 'stream ended without a done event'
  return { totalMs: Math.round((firstAt ?? performance.now()) - t0), text, thinkingText, toolCalls, finish, usage, error }
}

async function turnWithTools(messages: unknown[], options: Record<string, number>, think: boolean) {
  const first = await chat(messages, options, think)
  let last = first
  const allTools = [...first.toolCalls]
  let steps = 1
  while (!last.error && last.toolCalls.length && !last.text.replace(/<\|[^|]*\|>/g, '').trim() && steps < 3) {
    messages.push({ role: 'assistant', content: last.text, tool_calls: last.toolCalls })
    for (const c of last.toolCalls as { function: { name: string } }[]) messages.push({ role: 'tool', tool_name: c.function.name, content: JSON.stringify({ success: true }) })
    last = await chat(messages, options, think)
    allTools.push(...last.toolCalls)
    steps++
  }
  return { ...last, firstUsage: first.usage, totalMs: first.totalMs + (last === first ? 0 : last.totalMs), toolCalls: allTools, steps }
}

for (const cfg of configs) {
  const replies: Array<Record<string, unknown> & { error: string | null }> = []
  const messages: unknown[] = [{ role: 'system', content: system }]
  let failed = false
  for (const [i, t] of script.entries()) {
    messages.push(userMsg(t, i))
    const r = await turnWithTools(messages, cfg.options, cfg.think)
    replies.push({ kind: 'turn', turn: i + 1, user: t, ...r })
    if (r.error && !r.text) {
      failed = true
      break
    }
    messages.push({ role: 'assistant', content: r.text })
  }
  if (!failed) {
    for (let k = 0; k < PROBES; k++)
      replies.push({ kind: 'probe', user: 'hey', ...await turnWithTools([{ role: 'system', content: system }, userMsg('hey', 0)], cfg.options, cfg.think) })
  }
  appendFileSync(OUT, `${JSON.stringify({ model, config: cfg.name, options: cfg.options, think: cfg.think, withTools, modelDefaults: show.parameters ?? '', details: show.details ?? {}, replies })}\n`)
  console.info(`SWEEP ${model} ${cfg.name}: ${replies.filter(r => r.error).length} errors, ${replies.length} replies`)
}
await fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model, keep_alive: 0 }) })
console.info(`SWEEP_DONE ${model}`)
