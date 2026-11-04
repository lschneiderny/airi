import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import messages from '@proj-airi/i18n/locales'

import { createFallbackOptions } from '@proj-airi/i18n'
import { array, literal, object, parse, string, union } from 'valibot'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'

import { parseExposedActions, renderActionsSection } from './exposed-actions'

const pinned = parse(object({
  exposedActions: array(object({ label: string(), kind: union([literal('gesture'), literal('action'), literal('dance')]) })),
  text: string(),
}), JSON.parse(readFileSync(join(import.meta.dirname, '../../fixtures/model/actions-prompt.json'), 'utf8')))

describe('parseExposedActions', () => {
  it('parses label:kind pairs in order', () => {
    expect(parseExposedActions('wave:gesture,moonwalk:dance,step:action')).toEqual([
      { label: 'wave', kind: 'gesture' },
      { label: 'moonwalk', kind: 'dance' },
      { label: 'step', kind: 'action' },
    ])
  })

  it.each([
    ['wave', 'expected label:kind'],
    ['wave:', 'expected label:kind'],
    [':gesture', 'expected label:kind'],
    ['wave:gesture:extra', 'expected label:kind'],
    ['wave:jig', 'unknown kind "jig"'],
    ['Wave!:gesture', 'invalid label'],
    ['wave:gesture,,nod:gesture', 'expected label:kind'],
    ['wave:gesture,wave:dance', 'duplicate label "wave"'],
    ['', 'expected label:kind'],
  ])('rejects %j with a clear error', (value, message) => {
    expect(() => parseExposedActions(value)).toThrow(message)
  })
})

describe('renderActionsSection', () => {
  const { global } = createI18n({ legacy: false, locale: 'en', messages, ...createFallbackOptions(() => {}) })
  const t = (key: string, params?: Record<string, string>) => params ? global.t(key, params) : global.t(key)

  it('renders the text pinned from stage-ui useStageActionsPrompt', () => {
    expect(renderActionsSection(pinned.exposedActions, t)).toBe(pinned.text)
  })

  it('omits the sentence whose list is empty and renders nothing for no actions', () => {
    expect(renderActionsSection([{ label: 'wave', kind: 'gesture' }], t)).not.toContain('perform_action')
    expect(renderActionsSection([{ label: 'step', kind: 'action' }], t)).not.toContain('"action" set to')
    expect(renderActionsSection([], t)).toBe('')
  })
})
