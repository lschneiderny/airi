import { describe, expect, it } from 'vitest'

import { parseLinuxMemory, parseMacosMemory, parsePressureLevel, parsePsiSome10, parseSwapUsage } from './parse'

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                              282052.
Pages active:                            274043.
Pages inactive:                          234375.
Pages speculative:                        73399.
Pages throttled:                              0.
Pages wired down:                        126478.
Pages purgeable:                           4324.
"Translation faults":                4873150912.
Pages copy-on-write:                   68899861.
Pages zero filled:                   3170628508.
Pages reactivated:                    466998537.
Pages purged:                           7826963.
File-backed pages:                       329361.
Anonymous pages:                         252456.
Pages stored in compressor:              363843.
Pages occupied by compressor:             21492.
Decompressions:                       497839528.
Compressions:                         762401720.
Pageins:                               97177476.
Pageouts:                                808374.
Swapins:                                3196578.
Swapouts:                               4021120.
`

const SYSCTL = `total = 3072.00M  used = 1862.19M  free = 1209.81M  (encrypted)
2
17179869184
`

const MEMINFO = `MemTotal:       16303956 kB
MemFree:         1203348 kB
MemAvailable:    9876544 kB
Buffers:          312004 kB
Cached:          7934120 kB
SwapCached:        10240 kB
Active:          6123456 kB
Inactive:        5987654 kB
SwapTotal:       8388604 kB
SwapFree:        8126460 kB
HugePages_Total:       0
Hugepagesize:       2048 kB
`

const PSI = `some avg10=1.53 avg60=0.87 avg300=0.21 total=123456789
full avg10=0.40 avg60=0.12 avg300=0.03 total=23456789
`

describe('parseMacosMemory', () => {
  it('counts active, wired, and compressor-occupied pages as used memory', () => {
    const reading = parseMacosMemory(VM_STAT, SYSCTL)
    expect(reading.usedBytes).toBe((274043 + 126478 + 21492) * 16384)
    expect(reading.compressedBytes).toBe(21492 * 16384)
  })

  it('reads swap, pressure, and total memory from the sysctl lines', () => {
    const reading = parseMacosMemory(VM_STAT, SYSCTL)
    expect(reading.swapUsedBytes).toBe(Math.round(1862.19 * 1024 ** 2))
    expect(reading.pressure).toBe('warn')
    expect(reading.totalBytes).toBe(17179869184)
    expect(reading.psiSome10).toBeNull()
  })

  it('rejects vm_stat output without the page size header', () => {
    expect(() => parseMacosMemory(VM_STAT.split('\n').slice(1).join('\n'), SYSCTL)).toThrow('page size')
  })

  it('rejects vm_stat output without a counted page kind', () => {
    expect(() => parseMacosMemory(VM_STAT.replace(/^Pages wired down.*$/m, ''), SYSCTL)).toThrow('Pages wired down')
  })
})

describe('parseSwapUsage', () => {
  it('scales each unit suffix to bytes', () => {
    expect(parseSwapUsage('total = 2048.00M  used = 0.00M  free = 2048.00M  (encrypted)')).toBe(0)
    expect(parseSwapUsage('total = 4.00G  used = 1.50G  free = 2.50G  (encrypted)')).toBe(1.5 * 1024 ** 3)
    expect(parseSwapUsage('total = 1024.00K  used = 512.00K  free = 512.00K')).toBe(512 * 1024)
  })

  it('rejects text without a used figure', () => {
    expect(() => parseSwapUsage('unknown oid')).toThrow('vm.swapusage')
  })
})

describe('parsePressureLevel', () => {
  it('maps the kernel levels and leaves others unknown', () => {
    expect(parsePressureLevel('1\n')).toBe('normal')
    expect(parsePressureLevel('2')).toBe('warn')
    expect(parsePressureLevel('4')).toBe('critical')
    expect(parsePressureLevel('3')).toBeNull()
  })
})

describe('parseLinuxMemory', () => {
  it('derives used memory and swap from available and free figures', () => {
    const reading = parseLinuxMemory(MEMINFO, PSI)
    expect(reading.usedBytes).toBe((16303956 - 9876544) * 1024)
    expect(reading.swapUsedBytes).toBe((8388604 - 8126460) * 1024)
    expect(reading.totalBytes).toBe(16303956 * 1024)
    expect(reading.compressedBytes).toBeNull()
    expect(reading.pressure).toBeNull()
    expect(reading.psiSome10).toBe(1.53)
  })

  it('leaves PSI null on a kernel without the pressure file', () => {
    expect(parseLinuxMemory(MEMINFO, null).psiSome10).toBeNull()
  })

  it('rejects meminfo without MemAvailable', () => {
    expect(() => parseLinuxMemory(MEMINFO.replace(/^MemAvailable.*$/m, ''), null)).toThrow('MemAvailable')
  })
})

describe('parsePsiSome10', () => {
  it('reads only the some line', () => {
    expect(parsePsiSome10('full avg10=9.00 avg60=0.00 avg300=0.00 total=0\n')).toBeNull()
  })
})
