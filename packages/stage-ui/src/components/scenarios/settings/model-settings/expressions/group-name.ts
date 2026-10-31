/**
 * A readable name for a pick-one expression group, derived from its member labels.
 *
 * The longest leading word sequence shared by every label (compared case-insensitively,
 * keeping the first label's casing) with trailing digit-only words dropped, when it is
 * at least 3 characters long. Otherwise the first two labels joined with " / ", plus
 * ` +${n}` for the remaining members.
 */
export function groupDisplayName(labels: string[]): string {
  const words = labels.map(label => label.trim().split(/\s+/).filter(word => word !== ''))
  const first = words[0] ?? []
  let shared = 0
  while (shared < first.length && words.every(list => list[shared]?.toLowerCase() === first[shared].toLowerCase()))
    shared++
  while (shared > 0 && /^\d+$/.test(first[shared - 1]))
    shared--
  const prefix = first.slice(0, shared).join(' ')
  if (prefix.length >= 3)
    return prefix
  const head = labels.slice(0, 2).join(' / ')
  return labels.length > 2 ? `${head} +${labels.length - 2}` : head
}
