import type { Live2DCanvasPoint, Live2DItemPin } from './pin'
import type { Live2DItemPose } from './pose'

// NOTICE:
// The vendored `pixi-live2d-display` typings describe an older Cubism Core and lack
// `Drawables.parentPartIndices`, which the shipped Core 5 (`live2dcubismcore.min.js`,
// `csmGetDrawableParentPartIndices`) fills; the editor groups drawables by part through it.
// Source: node_modules/pixi-live2d-display/types/index.d.ts (`class Drawables`), apps/stage-tamagotchi/public/assets/js/CubismSdkForWeb-5-r.3/Core.
// Remove when pixi-live2d-display ships typings for Core 4-r.7 or later.
export interface Live2DCoreDrawableParents {
  /** The index of the part that owns each drawable, or -1 for none; absent on a Core older than 4-r.7. */
  parentPartIndices?: Int32Array
}

/** One part of her model, for the hide-list tree: `depth` is its distance from a root part. */
export interface Live2DEditorPart {
  id: string
  /** The cdi3 display name, or the id when the model ships no display info. */
  name: string
  parentId: string | null
  depth: number
}

/** One drawable of her model with the part that owns it, for the layer picker. */
export interface Live2DEditorDrawable {
  id: string
  partId: string | null
}

/**
 * What the placement editor reads from her loaded model. The scene exposes it; the
 * editor never reaches into the internal model. Points are model canvas units unless
 * named `view`, which are CSS pixels relative to the scene's canvas element.
 */
export interface Live2DItemEditor {
  /** Her model canvas (`originalWidth`, `originalHeight`), the unit of item placement. */
  canvas: { width: number, height: number }
  parts: readonly Live2DEditorPart[]
  drawables: readonly Live2DEditorDrawable[]
  /** Pins a point to the topmost visible mesh under it, or `undefined` over empty canvas. */
  pickPin: (point: Live2DCanvasPoint) => Live2DItemPin | undefined
  canvasToView: (point: Live2DCanvasPoint) => Live2DCanvasPoint
  viewToCanvas: (point: Live2DCanvasPoint) => Live2DCanvasPoint
  /** Where a drawn item sits this frame, or `undefined` while nothing draws for it. */
  poseOf: (id: string) => Live2DItemPose | undefined
}

/**
 * What the model component exposes: the editor over renderer pixels (`global`), before
 * the scene maps them onto its canvas element.
 */
export interface Live2DModelItemEditor extends Omit<Live2DItemEditor, 'canvasToView' | 'viewToCanvas'> {
  canvasToGlobal: (point: Live2DCanvasPoint) => Live2DCanvasPoint
  globalToCanvas: (point: Live2DCanvasPoint) => Live2DCanvasPoint
}

/** Maps the model editor onto the canvas element; `pixelsPerCssPixel` is its backing size over its displayed size. */
export function viewItemEditor(editor: Live2DModelItemEditor, pixelsPerCssPixel: () => number): Live2DItemEditor {
  const { canvasToGlobal, globalToCanvas, ...rest } = editor
  return {
    ...rest,
    canvasToView: (point) => {
      const ratio = pixelsPerCssPixel()
      const global = canvasToGlobal(point)
      return { x: global.x / ratio, y: global.y / ratio }
    },
    viewToCanvas: (point) => {
      const ratio = pixelsPerCssPixel()
      return globalToCanvas({ x: point.x * ratio, y: point.y * ratio })
    },
  }
}

/** The cdi3 `Parts` names by part id. Vendor metadata is untrusted; a malformed record hides no valid name. */
export function readPartDisplayNames(displayInfo: unknown): Map<string, string> {
  const names = new Map<string, string>()
  if (!displayInfo || typeof displayInfo !== 'object' || !('Parts' in displayInfo) || !Array.isArray(displayInfo.Parts))
    return names
  for (const part of displayInfo.Parts) {
    if (part && typeof part === 'object'
      && 'Id' in part && typeof part.Id === 'string'
      && 'Name' in part && typeof part.Name === 'string') {
      names.set(part.Id, part.Name)
    }
  }
  return names
}

/**
 * Her parts as a tree in depth-first order, roots first in model order. `parentIndices`
 * is the core's table, with -1 for a root; a parent index outside the table counts as a
 * root, so a broken table still lists every part once.
 */
export function partTreeOf(ids: readonly string[], parentIndices: ArrayLike<number>, names: ReadonlyMap<string, string>): Live2DEditorPart[] {
  const children = new Map<number, number[]>()
  const roots: number[] = []
  for (let index = 0; index < ids.length; index++) {
    const parent = parentIndices[index]
    if (parent >= 0 && parent < ids.length && parent !== index) {
      const siblings = children.get(parent)
      if (siblings)
        siblings.push(index)
      else
        children.set(parent, [index])
    }
    else {
      roots.push(index)
    }
  }
  const tree: Live2DEditorPart[] = []
  const seen = new Set<number>()
  const visit = (index: number, parentId: string | null, depth: number) => {
    // A cycle in a broken table would otherwise recurse forever.
    if (seen.has(index))
      return
    seen.add(index)
    tree.push({ id: ids[index], name: names.get(ids[index]) ?? ids[index], parentId, depth })
    for (const child of children.get(index) ?? [])
      visit(child, ids[index], depth + 1)
  }
  for (const root of roots)
    visit(root, null, 0)
  // Parts only reachable through a cycle still get listed, as roots.
  for (let index = 0; index < ids.length; index++)
    visit(index, null, 0)
  return tree
}

/** Her drawables with the part that owns each, from the core's `parentPartIndices` table. */
export function drawablesOf(ids: readonly string[], parentPartIndices: ArrayLike<number>, partIds: readonly string[]): Live2DEditorDrawable[] {
  return ids.map((id, index) => {
    const part = parentPartIndices[index]
    return { id, partId: part >= 0 && part < partIds.length ? partIds[part] : null }
  })
}
