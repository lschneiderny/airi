import type { BaseIssue, BaseSchema, InferOutput } from 'valibot'

import { array, boolean, finite, maxLength, minLength, minValue, nullable, number, picklist, pipe, safeInteger, safeParse, strictObject, string } from 'valibot'

const text = pipe(string(), maxLength(4096))
const coordinate = pipe(number(), finite())
const pid = pipe(number(), safeInteger(), minValue(0))
const hello = strictObject({ api: picklist(['plasma6', 'plasma5', 'unsupported']) })
const active = nullable(strictObject({
  caption: text,
  resourceClass: text,
  desktopFileName: text,
  pid,
  fullScreen: boolean(),
}))
const ownWindows = pipe(array(strictObject({
  id: pipe(string(), minLength(1), maxLength(256)),
  pid: pipe(pid, minValue(1)),
  x: coordinate,
  y: coordinate,
  width: pipe(coordinate, minValue(0)),
  height: pipe(coordinate, minValue(0)),
  keepAbove: boolean(),
  outputScale: pipe(coordinate, minValue(Number.MIN_VALUE)),
  // Own windows only; the binding handshake matches its `airi-bind-<n>` title here.
  caption: text,
})), maxLength(32))
const outputs = pipe(array(strictObject({
  name: pipe(string(), maxLength(256)),
  x: coordinate,
  y: coordinate,
  width: pipe(coordinate, minValue(1)),
  height: pipe(coordinate, minValue(1)),
  scale: pipe(coordinate, minValue(Number.MIN_VALUE)),
})), maxLength(16))
const cursor = strictObject({ x: coordinate, y: coordinate })
const ownPids = pipe(array(pipe(pid, minValue(1))), maxLength(256))

export class KwinProtocolError extends Error {
  constructor() {
    // Never include parser issues or the input: both can contain window titles.
    super('Invalid KWin payload')
    this.name = 'KwinProtocolError'
  }
}

function parsePayload<T extends BaseSchema<unknown, unknown, BaseIssue<unknown>>>(schema: T, payload: unknown): InferOutput<T> {
  if (typeof payload !== 'string' || payload.length > 65536)
    throw new KwinProtocolError()
  let decoded: unknown
  try {
    decoded = JSON.parse(payload)
  }
  catch (error) {
    if (error instanceof SyntaxError)
      throw new KwinProtocolError()
    throw error
  }
  const result = safeParse(schema, decoded)
  if (!result.success)
    throw new KwinProtocolError()
  return result.output
}

export function parseHello(payload: unknown) {
  return parsePayload(hello, payload)
}
export function parseActive(payload: unknown) {
  return parsePayload(active, payload)
}
export function parseOwnWindows(payload: unknown) {
  return parsePayload(ownWindows, payload)
}
export function parseCursor(payload: unknown) {
  return parsePayload(cursor, payload)
}
export function parseOutputs(payload: unknown) {
  return parsePayload(outputs, payload)
}
/** OwnPids has no request arguments; its reply is a JSON array of process IDs. */
export function parseOwnPids(payload: unknown) {
  return parsePayload(ownPids, payload)
}

export type KwinMessage
  = | { readonly method: 'Hello', readonly payload: InferOutput<typeof hello> }
    | { readonly method: 'Active', readonly payload: InferOutput<typeof active> }
    | { readonly method: 'OwnWindows', readonly payload: InferOutput<typeof ownWindows> }
    | { readonly method: 'Cursor', readonly payload: InferOutput<typeof cursor> }
    | { readonly method: 'Outputs', readonly payload: InferOutput<typeof outputs> }
