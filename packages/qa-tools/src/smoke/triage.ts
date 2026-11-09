import type { PageError } from './page-errors'

import { array, minLength, object, parse, picklist, pipe, string } from 'valibot'

/**
 * A known error a clean start may log. Every entry names why it is acceptable and when to delete it, like the
 * known-failures registry; an entry without a concrete cause does not belong here.
 */
export interface AllowedError {
  /** A regular expression source, matched against `text`. */
  pattern: string
  kind: PageError['kind'] | 'main'
  reason: string
  added: string
  removeWhen: string
}

const nonEmpty = pipe(string(), minLength(1))
const allowedErrorsSchema = array(object({
  pattern: nonEmpty,
  kind: picklist(['exception', 'console', 'log', 'main']),
  reason: nonEmpty,
  added: nonEmpty,
  removeWhen: nonEmpty,
}))

export function parseAllowedErrors(json: unknown): AllowedError[] {
  const entries = parse(allowedErrorsSchema, json)
  for (const entry of entries)
    void new RegExp(entry.pattern)
  return entries
}

const ansiPattern = /\x1B\[[0-9;]*m/g

/**
 * Error lines the Electron main process and the dev session wrote. The app logger tags errors `[error]`; Node
 * reports uncaught errors and unhandled rejections without a tag. Chromium's own `:ERROR:` lines (Wayland color
 * management, GPU probes) and the renderer console lines and errors that Vite echoes as `[vite] (client)` are excluded: the first are platform noise
 * outside the app's control, and the second are already collected from the windows over CDP.
 */
export function scanMainLog(text: string): string[] {
  return text
    .replace(ansiPattern, '')
    .split('\n')
    .filter(line => !line.includes('[vite] (client)'))
    .filter(line => /\[error\]|Uncaught(?:Exception)?\b|UnhandledPromiseRejection|Unhandled rejection/.test(line))
    .map(line => line.trim())
}

export interface SmokeErrorTriage {
  unexpected: PageError[]
  allowed: Array<PageError & { reason: string }>
  mainUnexpected: string[]
  mainAllowed: Array<{ text: string, reason: string }>
}

export function triageErrors(pageErrors: readonly PageError[], mainLines: readonly string[], allowList: readonly AllowedError[]): SmokeErrorTriage {
  const match = (kind: AllowedError['kind'], text: string) => allowList.find(entry => entry.kind === kind && new RegExp(entry.pattern).test(text))
  const triage: SmokeErrorTriage = { unexpected: [], allowed: [], mainUnexpected: [], mainAllowed: [] }
  for (const error of pageErrors) {
    const entry = match(error.kind, error.text)
    if (entry)
      triage.allowed.push({ ...error, reason: entry.reason })
    else
      triage.unexpected.push(error)
  }
  for (const line of mainLines) {
    const entry = match('main', line)
    if (entry)
      triage.mainAllowed.push({ text: line, reason: entry.reason })
    else
      triage.mainUnexpected.push(line)
  }
  return triage
}
