import type { MotionScenarioClass } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

import * as v from 'valibot'

import { ReferenceRefusal } from './bvh'

const text = v.pipe(v.string(), v.nonEmpty())
const relativeFile = v.pipe(text, v.check(file => !isAbsolute(file) && !file.includes('\\') && !file.split('/').includes('..'), 'Expected a relative file inside the reference directory'))
const manifestSchema = v.object({
  datasets: v.array(v.object({ id: text, licence: text, url: v.pipe(text, v.url()) })),
  clips: v.array(v.object({
    file: relativeFile,
    dataset: text,
    class: v.picklist(['idle', 'talk', 'gaze', 'emotion', 'walk', 'react']),
    profile: v.picklist(['cmu', '100style']),
    split: v.picklist(['fit', 'holdout']),
    subject: text,
    role: v.picklist(['window', 'episode-only']),
    emphasis: v.optional(relativeFile),
  })),
})

export type ReferenceManifest = v.InferOutput<typeof manifestSchema>
export type ReferenceClip = ReferenceManifest['clips'][number]

export function parseManifest(input: unknown): ReferenceManifest {
  const result = v.safeParse(manifestSchema, input)
  if (!result.success)
    throw new ReferenceRefusal('reference-manifest', v.summarize(result.issues))
  const manifest = result.output
  const datasets = manifest.datasets.map(dataset => dataset.id)
  if (new Set(datasets).size !== datasets.length || manifest.clips.some(clip => !datasets.includes(clip.dataset)))
    throw new ReferenceRefusal('reference-manifest', 'Dataset ids must be unique and every clip must name a dataset')
  const keys = manifest.clips.map(clip => `${clip.class}/${clip.file}`)
  if (new Set(keys).size !== keys.length)
    throw new ReferenceRefusal('reference-manifest', 'Duplicate clip within a class')
  return manifest
}

export async function readManifest(path: string): Promise<ReferenceManifest> {
  return parseManifest(JSON.parse(await readFile(path, 'utf8')))
}

export function listClips(manifest: ReferenceManifest, scenarioClass: MotionScenarioClass, split: ReferenceClip['split']): ReferenceClip[] {
  return manifest.clips.filter(clip => clip.class === scenarioClass && clip.split === split)
}
