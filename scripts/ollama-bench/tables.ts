import { scoreReplies } from './score'

const dir = Bun.argv[2] ?? '.'
const read = async (f: string) => (await Bun.file(`${dir}/${f}`).text().catch(() => '')).trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
const big = await read('bench.jsonl')
const sweep = await read('sweep.jsonl')
const fa = await read('flash-attention.jsonl')

const s = (ms: number | null | undefined) => ms == null ? 'n/a' : (ms / 1000).toFixed(ms < 10_000 ? 2 : 1)
const median = (xs: number[]) => xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null

function speedRow(r: any) {
  const t1 = r.turns[0]
  const warm = median(r.turns.slice(1).map((t: any) => t.ttftMs).filter((v: any) => v != null))
  const gen = r.turns.reduce((a: number, t: any) => a + (t.usage?.evalTokens ?? 0), 0) / Math.max(1, r.turns.reduce((a: number, t: any) => a + (t.usage?.evalMs ?? 0), 0) / 1000)
  const gb = r.ps ? (r.ps.sizeBytes / 1e9).toFixed(1) : 'n/a'
  const gpu = r.ps ? `${Math.round(100 * r.ps.vramBytes / r.ps.sizeBytes)}%` : 'n/a'
  return { model: r.model, tools: r.withTools ? 'yes' : 'no', prompt: t1?.usage?.promptTokens ?? 'n/a', cold: s(t1?.ttftMs), warm: s(warm), gen: gen ? gen.toFixed(1) : 'n/a', mem: `${gb} GB / ${gpu}`, firstLoad: r.firstLoadError ? 'failed once' : (t1?.error && !t1?.text ? 'failed' : 'ok') }
}

function md(rows: Record<string, unknown>[], cols: [string, string][]) {
  return [
    `| ${cols.map(c => c[1]).join(' | ')} |`,
    `| ${cols.map(() => '---').join(' | ')} |`,
    ...rows.map(r => `| ${cols.map(c => String(r[c[0]] ?? '')).join(' | ')} |`),
  ].join('\n')
}

console.info('### Speed and memory (default run)\n')
console.info(md(big.map(speedRow), [['model', 'Model'], ['tools', 'Tools sent'], ['prompt', 'Turn 1 prompt tokens'], ['cold', 'Cold first token (s)'], ['warm', 'Warm first token, median (s)'], ['gen', 'Generation (tok/s)'], ['mem', 'Loaded size / on GPU'], ['firstLoad', 'First request']]))

console.info('\n### Settings sweep (7 replies per variant)\n')
const sweepRows = sweep.map((r: any) => ({ model: r.model, config: r.config, ...scoreReplies(r.replies) }))
console.info(md(sweepRows, [['model', 'Model'], ['config', 'Variant'], ['blank', 'Blank'], ['toolNoSpeech', 'Tool call, no speech'], ['errors', 'Errors'], ['badCue', 'Invalid cue'], ['jsonCue', 'JSON cue'], ['malformed', 'Malformed'], ['emoji', 'Emoji'], ['stageDir', 'Stage dir.'], ['lower', 'Lowercase'], ['persona', 'Shuka markers'], ['words', 'Words'], ['avgReplyS', 'Avg reply (s)']]))

if (fa.length) {
  console.info('\n### Flash attention + q8_0 cache (default run)\n')
  console.info(md(fa.map(speedRow), [['model', 'Model'], ['prompt', 'Turn 1 prompt tokens'], ['cold', 'Cold first token (s)'], ['warm', 'Warm first token, median (s)'], ['gen', 'Generation (tok/s)'], ['mem', 'Loaded size / on GPU'], ['firstLoad', 'First request']]))
}
