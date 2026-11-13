import type { IdleBehaviourReport, NaturalIdleDrive } from '@proj-airi/motion-driver-natural/idle-activities'

/** A named idle drive that a scenario sets for its whole run; the name and the values go into the run's provenance. */
export interface Motion3dIdleDrive {
  readonly name: string
  readonly drive: Readonly<NaturalIdleDrive>
}

/**
 * The product's documented neutral drive (`NaturalIdleDrive`: "all zero, no music: a rested daytime character who
 * talked a moment ago") as the app's conductor and an MMD scene without a sleep clip or a playing clip send it: sleep
 * allowed, rate 1, and the whole-body capability the MMD scene declares. Neutral mood, daytime, user present (goal 4
 * unit M2 rules, section 1 and amendment 9).
 */
export const QA_IDLE_DRIVE: Readonly<NaturalIdleDrive> = { energy: 0, valence: 0, tension: 0, sleepiness: 0, solitude: 0, music: false, allowSleep: true, rate: 1, body: true }

/** C001's fixed drive: the user present and inactive for the whole run. */
export const QA_DRIVE_PRESENT: Motion3dIdleDrive = { name: 'qa-neutral-day', drive: QA_IDLE_DRIVE }

/** C004's drive: the same values; the user leaves at the scenario's away cue, which reaches Natural as `away`. */
export const QA_DRIVE_AWAY: Motion3dIdleDrive = { name: 'qa-neutral-day-away', drive: QA_IDLE_DRIVE }

/** The trace source detail of a run with `drive`: its name and its values as JSON, in the drive's field order. */
export function idleDriveDetail(drive: Motion3dIdleDrive): { idleDrive: string, idleDriveValues: string } {
  return { idleDrive: drive.name, idleDriveValues: JSON.stringify(drive.drive) }
}

export const IDLE_MARKER = 'idle:'

/** The trace marker of one scheduler report: `idle:<kind>:<start|end>`. */
export function idleMarkerLabel(report: IdleBehaviourReport): string {
  return `${IDLE_MARKER}${report.behaviour}:${report.phase}`
}
