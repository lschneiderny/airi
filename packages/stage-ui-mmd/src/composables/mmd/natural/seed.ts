/** FNV-1a over UTF-16 code units, including each half of a surrogate pair. */
export function fnv1a32(modelKey: string): number {
  let hash = 0x811C9DC5
  for (let index = 0; index < modelKey.length; index++)
    hash = Math.imul(hash ^ modelKey.charCodeAt(index), 0x01000193)
  return hash >>> 0
}
