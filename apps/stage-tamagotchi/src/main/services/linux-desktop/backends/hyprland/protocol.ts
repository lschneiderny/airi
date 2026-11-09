import type { BaseIssue, BaseSchema, InferOutput } from 'valibot'

import type { KwinMessage } from '../kwin/protocol'

import { array, finite, maxLength, minLength, minValue, number, object, picklist, pipe, regex, safeInteger, safeParse, string, tuple } from 'valibot'

const text = pipe(string(), maxLength(4096))
const coordinate = pipe(number(), finite())
const pid = pipe(number(), safeInteger(), minValue(1))
const geometry = {
  address: pipe(string(), minLength(3), maxLength(256), regex(/^0x[0-9a-f]+$/i)),
  pid,
  title: text,
  at: tuple([coordinate, coordinate]),
  size: tuple([pipe(coordinate, minValue(0)), pipe(coordinate, minValue(0))]),
}
const active = object({ ...geometry, class: text, fullscreen: picklist([0, 1, 2]) })
const clients = pipe(array(object(geometry)), maxLength(4096))
const cursor = object({ x: coordinate, y: coordinate })

/** Replies are bounded before JSON decoding, including calls outside the socket client. */
function decode<T extends BaseSchema<unknown, unknown, BaseIssue<unknown>>>(schema: T, input: unknown): InferOutput<T> | null {
  if (typeof input !== 'string' || input.length > 1048576)
    return null
  let value: unknown
  try {
    value = JSON.parse(input)
  }
  catch (error) {
    if (error instanceof SyntaxError)
      return null
    throw error
  }
  const result = safeParse(schema, value)
  return result.success ? result.output : null
}

export function parseActive(input: unknown) {
  const window = decode(active, input)
  return window
    ? {
        caption: window.title,
        resourceClass: window.class,
        desktopFileName: '',
        pid: window.pid,
        // Hyprland's internal mode enum distinguishes maximized (1) from fullscreen (2).
        fullScreen: window.fullscreen === 2,
      }
    : null
}

export function parseOwnWindows(input: unknown, ownPids: readonly number[]) {
  const windows = decode(clients, input)
  return windows?.filter(window => ownPids.includes(window.pid)).slice(0, 32).map(window => ({
    id: window.address,
    pid: window.pid,
    caption: window.title,
    x: window.at[0],
    y: window.at[1],
    width: window.size[0],
    height: window.size[1],
  })) ?? null
}

export function parseCursor(input: unknown) {
  return decode(cursor, input)
}

/** Event contents only invalidate cached replies; titles never become commands. */
export function parseEvent(line: string) {
  if (line.length > 4096 || /[\r\n]/.test(line))
    return null
  const separator = line.indexOf('>>')
  if (separator < 0)
    return null
  const event = line.slice(0, separator)
  const data = line.slice(separator + 2)
  switch (event) {
    case 'activewindowv2':
      return /^[0-9a-f]*$/i.test(data) ? { event, data } : null
    case 'windowtitlev2':
      return /^[0-9a-f]+,/i.test(data) ? { event, data } : null
    case 'fullscreen':
      return /^[01]$/.test(data) ? { event, data } : null
    default:
      return null
  }
}

export type HyprlandMessage
  = | Extract<KwinMessage, { method: 'Active' | 'Cursor' }>
    | { readonly method: 'OwnWindows', readonly payload: ReturnType<typeof parseOwnWindows> }
