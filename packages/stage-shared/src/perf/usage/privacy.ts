const MODEL_NAME_MAX_CHARS = 80

/**
 * Reduces a model file name or path to a label safe to record: the basename without its last extension,
 * with no path separators, at most 80 characters. Perf records never carry a personal asset path.
 */
export function sanitizeModelName(name: string): string {
  const basename = name.split(/[/\\]/).at(-1) ?? ''
  const dot = basename.lastIndexOf('.')
  const stem = dot > 0 ? basename.slice(0, dot) : basename
  return stem.slice(0, MODEL_NAME_MAX_CHARS)
}

// Text that must never reach a perf file: a POSIX path (`/home/user/`, not a lone `1/2`), a Windows drive
// path (`C:\`, also JSON-escaped), a URL, and an `sk-` key at a word start (`task-12345678` passes).
const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /\/[^/\s"]+\//,
  /\b[A-Z]:\\/i,
  /:\/\//,
  /\bsk-[\w-]{8,}/,
]

/** Whether a serialized perf line holds path-, URL- or key-like text. Tests use it to check recorder output. */
export function containsForbiddenText(line: string): boolean {
  return FORBIDDEN_PATTERNS.some(pattern => pattern.test(line))
}
