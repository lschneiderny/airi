import { describe, expect, it } from 'vitest'

import { historyText } from './history'

describe('historyText', () => {
  const reply = '<|ACT {"emotion":"happy"}|> Morning! <|look: you|> I missed you. <|MOOD warm|> [ACT sad] Sorry.'

  it('sends the reply as written in raw mode', async () => {
    await expect(historyText(reply, 'raw')).resolves.toBe(reply)
  })

  it('keeps only markers the stage accepts in accepted mode', async () => {
    const kept = await historyText(reply, 'accepted')

    expect(kept).toContain('<|ACT {"emotion":"happy"}|>')
    expect(kept).toContain('<|MOOD warm|>')
    expect(kept).not.toContain('look')
    expect(kept).toContain('Morning!')
    expect(kept).toContain('I missed you.')
  })

  it('rewrites a recovered cue in canonical mode and keeps unknown markers', async () => {
    const canonical = await historyText(reply, 'canonical')

    expect(canonical).toContain('<|ACT sad|>')
    expect(canonical).toContain('<|look: you|>')
  })
})
