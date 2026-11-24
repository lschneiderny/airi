import type { CharacterProfile } from './types'

/** A profile's pep, 0 when absent. */
export function pepOf(profile: Pick<CharacterProfile, 'pep'> | undefined): number {
  return profile?.pep ?? 0
}

/** `value` rounded to hundredths and clamped to [0, 1]; `undefined` at 0, so a calm card stores no pep. */
export function normalizePep(value: number): number | undefined {
  const pep = Math.min(1, Math.max(0, Math.round(value * 100) / 100))
  return pep === 0 ? undefined : pep
}
