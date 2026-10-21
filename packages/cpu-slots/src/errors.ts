export type CpuSlotsErrorCode = 'bad-budget' | 'exclusive-under-shared'

export class CpuSlotsError extends Error {
  constructor(public readonly code: CpuSlotsErrorCode) {
    super(code)
    this.name = 'CpuSlotsError'
  }
}
