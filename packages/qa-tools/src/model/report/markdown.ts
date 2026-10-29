import type { RunScore } from '../score/aggregate'

function escapeCell(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '&#124;').replaceAll('`', '&#96;').replace(/\r\n|\r|\n/g, '<br>')
}

function number(value: number | null): string {
  return value === null ? 'n/a' : String(Number(value.toFixed(2)))
}

function top(counts: [string, number][]): string {
  return counts.slice(0, 3).map(([name, count]) => `${name}: ${count}`).join(', ') || '-'
}

/** A deterministic offline summary. Operational timestamps and git identity belong only in run.json. */
export function renderSummaryMarkdown(runs: RunScore[]): string {
  const sorted = [...runs].sort((a, b) => a.runKey < b.runKey ? -1 : a.runKey > b.runKey ? 1 : 0)
  const unique = (values: string[]) => [...new Set(values)].sort().map(escapeCell).join(', ') || 'n/a'
  const lines = [
    '# Model evaluation summary',
    '',
    `Scorer: ${unique(sorted.map(run => `${run.scorer.id} v${run.scorer.version}`))}`,
    `Closure digest: ${unique(sorted.map(run => run.sources.closureDigest))}`,
    `Contract version: ${unique(sorted.map(run => run.prompt.contractVersion ?? 'unknown'))}`,
    `Fixtures passed/total: ${unique(sorted.map(run => `${run.fixtures.passed}/${run.fixtures.total}`))}`,
    '',
    'Heuristic columns are not persona judgment.',
  ]
  const sets = [...new Set(sorted.map(run => run.set))].sort()
  for (const set of sets) {
    const rows = sorted.filter(run => run.set === set)
    const timed = rows.some(run => run.timing !== null)
    lines.push(
      '',
      `## ${escapeCell(set)}`,
      '',
      `**Contract**: replies through chunkVariant. **Heuristic**: emoji through meanWords.${timed ? ' **Timing**: replies and generation latency/speed.' : ''}`,
      '',
    )
    const columns = [
      'Model',
      'Config',
      'replies',
      'errors',
      'blank',
      'toolNoSpeech',
      'parsed%',
      'recovered%',
      'rejected%',
      'none%',
      'leadCue%',
      'acts',
      'actsInert',
      'invalidEmotion',
      'inventedEmotions',
      'forms b/c/j',
      'intensity s/c/st/n/-/?',
      'fields e/m/l/ld/pe',
      'delay valid/count',
      'call valid/count',
      'stripped',
      'stageRejected',
      'unknownMarkers',
      'chunkVariant',
      'emoji',
      'stageDir',
      'firstLower%',
      'personaFace%',
      'aiBreak',
      'exampleEcho',
      'meanWords',
      ...(timed ? ['timing replies', 'meanTtftMs', 'meanTotalMs', 'genTps'] : []),
    ]
    lines.push(`| ${columns.join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`)
    for (const run of rows) {
      const spoken = Object.values(run.outcomes).reduce((sum, count) => sum + count, 0)
      const rate = (count: number) => `${spoken ? Math.round(100 * count / spoken) : 0}%`
      const cells: (string | number)[] = [
        run.model,
        run.config,
        run.replies,
        run.errors,
        run.blank,
        run.toolNoSpeech,
        rate(run.outcomes.parsed),
        rate(run.outcomes.recovered),
        rate(run.outcomes.rejected),
        rate(run.outcomes.none),
        rate(run.leadCue),
        run.acts,
        run.actsInert,
        run.invalidEmotion,
        top(run.inventedEmotions),
        `${run.forms.bare}/${run.forms.colon}/${run.forms.json}`,
        `${run.intensity.slight}/${run.intensity.clear}/${run.intensity.strong}/${run.intensity.number}/${run.intensity.none}/${run.intensity.unrecognized}`,
        `${run.fields.expression}/${run.fields.motion}/${run.fields.look}/${run.fields.lookDropped}/${run.fields.placeholderEcho}`,
        `${run.delay.valid}/${run.delay.count}`,
        `${run.call.valid}/${run.call.count}`,
        run.stripped,
        run.stageRejected,
        top(run.unknownMarkers),
        run.chunkVariant,
        run.style.emoji,
        run.style.stageDirection,
        rate(run.style.firstLetterLower),
        rate(run.style.personaFace),
        run.style.aiBreak,
        run.style.exampleEcho,
        number(run.style.meanWords),
      ]
      if (timed) {
        cells.push(
          run.timing?.replies ?? 'n/a',
          number(run.timing?.meanTtftMs ?? null),
          number(run.timing?.meanTotalMs ?? null),
          number(run.timing?.genTps ?? null),
        )
      }
      lines.push(`| ${cells.map(value => escapeCell(String(value))).join(' | ')} |`)
    }
  }
  return `${lines.join('\n')}\n`
}
