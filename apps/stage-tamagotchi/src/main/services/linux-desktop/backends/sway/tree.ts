import type { KwinMessage } from '../kwin/protocol'

import { array, boolean, finite, minValue, nullable, number, object, optional, pipe, safeInteger, safeParse, string, unknown } from 'valibot'

import { SwayProtocolError } from './ipc'

export type Active = Extract<KwinMessage, { method: 'Active' }>['payload']
export type OwnWindow = Extract<KwinMessage, { method: 'OwnWindows' }>['payload'][number] & { readonly caption: string }

const integer = pipe(number(), safeInteger(), minValue(0))
const coordinate = pipe(number(), finite())
const nodeSchema = object({
  id: integer,
  type: string(),
  rect: object({ x: coordinate, y: coordinate, width: pipe(coordinate, minValue(0)), height: pipe(coordinate, minValue(0)) }),
  name: optional(nullable(string()), null),
  app_id: optional(nullable(string()), null),
  window_properties: optional(nullable(object({ class: optional(nullable(string()), null) })), null),
  pid: optional(nullable(integer), null),
  focused: optional(boolean(), false),
  fullscreen_mode: optional(integer, 0),
  scale: optional(pipe(coordinate, minValue(Number.MIN_VALUE))),
  nodes: optional(array(unknown()), []),
  floating_nodes: optional(array(unknown()), []),
})

/** Walk both tiling and floating children; output scales apply to descendants. */
export function readTree(tree: unknown, ownPids: readonly number[]): { active: Active, ownWindows: OwnWindow[] } {
  const stack = [{ value: tree, scale: 1 }]
  const ownWindows: OwnWindow[] = []
  let active: Active = null
  while (stack.length) {
    const entry = stack.pop()
    if (!entry)
      break
    const result = safeParse(nodeSchema, entry.value)
    if (!result.success)
      throw new SwayProtocolError()
    const node = result.output
    const scale = node.type === 'output' ? node.scale ?? entry.scale : entry.scale
    for (const value of [...node.nodes, ...node.floating_nodes])
      stack.push({ value, scale })
    if (!node.pid || (node.type !== 'con' && node.type !== 'floating_con'))
      continue
    if (node.focused) {
      active = {
        caption: node.name ?? '',
        resourceClass: node.app_id ?? node.window_properties?.class ?? '',
        desktopFileName: node.app_id ?? '',
        pid: node.pid,
        fullScreen: node.fullscreen_mode > 0,
      }
    }
    if (ownPids.includes(node.pid)) {
      ownWindows.push({
        id: String(node.id),
        caption: node.name ?? '',
        pid: node.pid,
        ...node.rect,
        // Sway has no keep-above property; floating is not equivalent.
        keepAbove: false,
        outputScale: scale,
      })
    }
  }
  return { active, ownWindows }
}
