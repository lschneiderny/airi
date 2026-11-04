/** Class groups the Character inspector panels share, matching the Situation inspector's cards. */
export const cardClass = [
  'rounded-xl border p-3',
  'border-neutral-200/70 bg-white/80',
  'dark:border-neutral-800/80 dark:bg-neutral-950/60',
]
export const labelClass = ['text-xs font-medium uppercase tracking-[0.08em]', 'text-neutral-400 dark:text-neutral-500']
export const noteClass = ['text-xs', 'text-neutral-500 dark:text-neutral-400']
export const bodyClass = ['text-sm', 'text-neutral-700 dark:text-neutral-200']
export const cellClass = ['px-2 py-1.5 text-left align-top']
export const rowClass = ['border-t', 'border-neutral-200/70 dark:border-neutral-800/80']
export const errorClass = ['rounded-lg px-3 py-2 text-sm', 'bg-red-500/10 text-red-700 dark:text-red-300']
export const okClass = ['rounded-lg px-3 py-2 text-sm', 'bg-primary-500/10 text-primary-700 dark:text-primary-300']

/** Formats a mood or level value with three decimals and an explicit sign for signed axes. */
export function formatAxis(value: number, signed = true): string {
  const text = value.toFixed(3)
  return signed && value > 0 ? `+${text}` : text
}

/** Formats the three axes of a mood value as `v / e / t`. */
export function formatAxes(axes: { valence: number, energy: number, tension: number }): string {
  return `${formatAxis(axes.valence)} / ${formatAxis(axes.energy)} / ${formatAxis(axes.tension, false)}`
}

/** Formats a jump offset such as `1h`, `1d 1h`, or `7d`. */
export function formatOffset(ms: number): string {
  const hours = Math.round(ms / 3_600_000)
  const days = Math.floor(hours / 24)
  const rest = hours % 24
  if (days === 0)
    return `${rest}h`
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`
}

/** Formats a timestamp as a local date and time without seconds. */
export function formatDateTime(atMs: number): string {
  return new Date(atMs).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
