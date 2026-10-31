import type { InjectionKey, Ref } from 'vue'

import { inject, provide } from 'vue'

export type DesktopStageMode = 'window' | 'desktop'

export interface DesktopStageDisplay {
  id: string
  primary: boolean
  workArea: { x: number, y: number, width: number, height: number }
  scaleFactor: number
}

export interface DesktopStageState {
  /** The saved mode. It applies at the next launch. */
  mode: DesktopStageMode
  /** The host this launch built. */
  running: DesktopStageMode
  homeDisplayId: string
  displays: DesktopStageDisplay[]
}

/**
 * The host-neutral port the desktop stage settings use. Only the Electron settings page provides it, so a page that
 * cannot host a desktop stage (web, mobile) leaves the section hidden.
 *
 * The provider owns the state: it loads it once, keeps it current from host events, and refreshes it after each write.
 */
export interface DesktopStageHost {
  /** `null` until the host answered the first read. */
  state: Readonly<Ref<DesktopStageState | null>>
  setMode: (mode: DesktopStageMode) => Promise<void>
  setHomeDisplay: (displayId: string) => Promise<void>
  relaunch: () => Promise<void>
}

export const desktopStageHostKey: InjectionKey<DesktopStageHost> = Symbol('@proj-airi/desktop-stage-host')

export function provideDesktopStageHost(host: DesktopStageHost): void {
  provide(desktopStageHostKey, host)
}

export function useDesktopStageHost(): DesktopStageHost | undefined {
  return inject(desktopStageHostKey, undefined)
}
