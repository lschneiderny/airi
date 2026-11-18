/** The macOS memory pressure level, or null where the host reports none (Linux reports PSI instead). */
export type MemoryPressure = 'normal' | 'warn' | 'critical'

/** One reading of host memory, before the sampler stamps it with a time. */
export interface MemoryReading {
  /** Memory in use: active + wired + compressor pages on macOS, `MemTotal - MemAvailable` on Linux. */
  usedBytes: number
  /** Physical memory the macOS compressor occupies. Null on Linux. */
  compressedBytes: number | null
  swapUsedBytes: number | null
  pressure: MemoryPressure | null
  /** Linux PSI `some avg10`: the percentage of the last 10 s in which some task stalled on memory. */
  psiSome10: number | null
  totalBytes: number | null
}

const VM_STAT_PAGE_SIZE_PATTERN = /page size of (\d+) bytes/
const VM_STAT_LINE_PATTERN = /^"?([^":]+)"?:\s+(\d+)\.?$/

/**
 * Parses `vm_stat` output into its page size and page counts, keyed by the label without quotes, for example
 * `Pages active`. Throws when the header or a required count is missing.
 */
export function parseVmStat(text: string): { pageSizeBytes: number, pages: Record<string, number> } {
  const pageSize = VM_STAT_PAGE_SIZE_PATTERN.exec(text)
  if (!pageSize)
    throw new Error('vm_stat output has no page size header')
  const pages: Record<string, number> = {}
  for (const line of text.split('\n')) {
    const match = VM_STAT_LINE_PATTERN.exec(line.trim())
    if (match)
      pages[match[1].trim()] = Number(match[2])
  }
  return { pageSizeBytes: Number(pageSize[1]), pages }
}

const SWAP_USED_PATTERN = /used\s*=\s*([\d.]+)([KMG])/

/** Byte multipliers for the unit suffixes `sysctl vm.swapusage` prints. */
const SWAP_UNIT_BYTES: Record<string, number> = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 }

/** Parses `sysctl -n vm.swapusage`, for example `total = 3072.00M  used = 1862.19M  free = 1209.81M  (encrypted)`. */
export function parseSwapUsage(text: string): number {
  const match = SWAP_USED_PATTERN.exec(text)
  if (!match)
    throw new Error(`Unrecognized vm.swapusage output: ${JSON.stringify(text.trim())}`)
  return Math.round(Number(match[1]) * SWAP_UNIT_BYTES[match[2]])
}

/** Maps `kern.memorystatus_vm_pressure_level` (1 normal, 2 warn, 4 critical) to a level; other values are unknown. */
export function parsePressureLevel(text: string): MemoryPressure | null {
  switch (text.trim()) {
    case '1': return 'normal'
    case '2': return 'warn'
    case '4': return 'critical'
    default: return null
  }
}

/**
 * Builds a macOS reading from `vm_stat` and `sysctl -n vm.swapusage kern.memorystatus_vm_pressure_level hw.memsize`,
 * which prints one value per line in that order.
 */
export function parseMacosMemory(vmStat: string, sysctl: string): MemoryReading {
  const { pageSizeBytes, pages } = parseVmStat(vmStat)
  const page = (label: string) => {
    const count = pages[label]
    if (count === undefined)
      throw new Error(`vm_stat output has no "${label}" line`)
    return count * pageSizeBytes
  }
  const [swapLine = '', pressureLine = '', totalLine = ''] = sysctl.split('\n')
  const totalBytes = Number(totalLine.trim())
  const compressedBytes = page('Pages occupied by compressor')
  return {
    usedBytes: page('Pages active') + page('Pages wired down') + compressedBytes,
    compressedBytes,
    swapUsedBytes: parseSwapUsage(swapLine),
    pressure: parsePressureLevel(pressureLine),
    psiSome10: null,
    totalBytes: Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : null,
  }
}

const MEMINFO_LINE_PATTERN = /^(\w+):\s+(\d+)(?:\s+kB)?$/

/** Parses `/proc/meminfo` into byte values keyed by field name. The kernel prints these fields in KiB. */
export function parseMeminfo(text: string): Record<string, number> {
  const fields: Record<string, number> = {}
  for (const line of text.split('\n')) {
    const match = MEMINFO_LINE_PATTERN.exec(line.trim())
    if (match)
      fields[match[1]] = Number(match[2]) * (line.includes('kB') ? 1024 : 1)
  }
  return fields
}

const PSI_SOME_AVG10_PATTERN = /^some .*avg10=([\d.]+)/m

/** Reads `some avg10` from `/proc/pressure/memory`, or null when the line is absent. */
export function parsePsiSome10(text: string): number | null {
  const match = PSI_SOME_AVG10_PATTERN.exec(text)
  return match ? Number(match[1]) : null
}

/** Builds a Linux reading from `/proc/meminfo` and, when the kernel has PSI, `/proc/pressure/memory`. */
export function parseLinuxMemory(meminfo: string, psi: string | null): MemoryReading {
  const fields = parseMeminfo(meminfo)
  const field = (name: string) => {
    const value = fields[name]
    if (value === undefined)
      throw new Error(`/proc/meminfo has no ${name} line`)
    return value
  }
  const swapTotal = fields.SwapTotal
  const swapFree = fields.SwapFree
  return {
    usedBytes: field('MemTotal') - field('MemAvailable'),
    compressedBytes: null,
    swapUsedBytes: swapTotal !== undefined && swapFree !== undefined ? swapTotal - swapFree : null,
    pressure: null,
    psiSome10: psi === null ? null : parsePsiSome10(psi),
    totalBytes: field('MemTotal'),
  }
}
