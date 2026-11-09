import type { HostCapabilities } from '@proj-airi/stage-shared/host-capabilities'

import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

/**
 * The window's host capability snapshot: which signals the host can supply, and why not.
 * The main process resolves it once per window and answers this invoke on request.
 */
export const getHostCapabilities = defineInvokeEventa<HostCapabilities>('eventa:invoke:electron:host-capabilities:get')

/** Emitted with the new snapshot whenever a runtime failure or verification changes it. */
export const hostCapabilitiesChanged = defineEventa<HostCapabilities>('eventa:event:electron:host-capabilities:changed')

/** The sending window supplies local pointer coordinates for main-owned verification. */
export const reportPointerSample = defineInvokeEventa<void, { clientX: number, clientY: number, atMs: number }>('eventa:invoke:electron:host-capabilities:report-pointer-sample')

/** Capture activity is evidence only after the main-owned audio verifier accepts it. */
export const reportSystemAudioHeard = defineInvokeEventa<void, { level: number }>('eventa:invoke:electron:host-capabilities:report-system-audio-heard')

export const hostCapabilities = {
  get: getHostCapabilities,
  reportPointerSample,
  reportSystemAudioHeard,
}

export const hostCapabilitiesEvents = {
  changed: hostCapabilitiesChanged,
}
