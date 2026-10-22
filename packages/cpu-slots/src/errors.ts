export type CpuSlotsErrorCode = 'bad-budget' | 'exclusive-under-shared' | 'entry-unreadable'

export class CpuSlotsError extends Error {
  /** `detail` names what failed, such as the store path behind `entry-unreadable`. */
  constructor(public readonly code: CpuSlotsErrorCode, public readonly detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'CpuSlotsError'
  }
}
