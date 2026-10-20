import { Buffer } from 'node:buffer'

/** Escapes text and double-quoted attribute values. Apostrophes stay, so prose such as the limitations reads verbatim. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char)
}

/** Inline `data:` URL for a PNG; the page loads nothing from the network or the filesystem. */
export function pngDataUrl(bytes: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`
}

export function formatNumber(value: number | null | undefined, digits = 3): string {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return '—'
  return Math.abs(value) >= 1000 ? value.toFixed(0) : value.toPrecision(digits)
}

export function formatPair(pair: readonly [number, number] | null | undefined, digits = 3): string {
  return pair ? `[${formatNumber(pair[0], digits)}, ${formatNumber(pair[1], digits)}]` : '—'
}

export function shortSha(sha: string): string {
  return sha.slice(0, 10)
}
