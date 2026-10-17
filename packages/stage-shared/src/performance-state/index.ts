/**
 * What the character is doing as a performer. The stage resolves it from chat,
 * voice, and desktop signals, and the Natural motion driver reads it to choose
 * amplitude, shift rate, and gaze behavior for each mode.
 *
 * - `talking`: the character's own speech is playing.
 * - `listening`: the user is speaking into voice capture.
 * - `thinking`: the chat is generating a reply.
 * - `watching`: the user is active at the desktop, so the character follows it.
 * - `idle`: none of the above.
 */
export type PerformanceMode = 'idle' | 'watching' | 'listening' | 'thinking' | 'talking'

/** Where the character directs attention. The gaze layer maps each value to a fixation target. */
export type PerformanceAttention = 'camera' | 'screen' | 'cursor'

/**
 * Why `reactSeq` last advanced.
 *
 * - `none`: no reaction has happened yet.
 * - `wake`: the desktop was unlocked or resumed from sleep.
 * - `screen-change`: the screen content changed sharply.
 */
export type PerformanceReactKind = 'none' | 'wake' | 'screen-change'

/**
 * One resolved performance frame, passed as a single prop from the stage to the
 * Live2D scene.
 */
export interface PerformanceState {
  mode: PerformanceMode
  attention: PerformanceAttention
  /** The user has left the desktop: it is locked, suspended, or idle for minutes. */
  away: boolean
  /**
   * Increments once per reaction. Consumers start a reaction when the value
   * differs from the one they last saw, so a repeated frame never retriggers it.
   */
  reactSeq: number
  reactKind: PerformanceReactKind
}

/**
 * The latest desktop activity sample, written by the host (Electron main through
 * the renderer store). Web hosts never write one, so the resolver receives `null`.
 *
 * A `null` field means the host cannot measure that signal, for example idle
 * time and cursor position under Wayland. The resolver never treats an unknown
 * signal as activity.
 *
 * Timestamps share the epoch clock of {@link PerformanceInputs.nowMs}.
 */
export interface DesktopActivitySnapshot {
  /** Seconds since the last user input anywhere on the desktop. */
  idleSeconds: number | null
  locked: boolean
  suspendedAtMs: number | null
  resumedAtMs: number | null
  unlockedAtMs: number | null
  /** Loudness of other applications' audio output, 0..1. */
  systemAudioLevel: number | null
  /** Fraction of the screen that changed since the previous sample, 0..1. */
  screenChange: number | null
  sampledAtMs: number
}

/**
 * Developer override from the devtools Natural lab. When present, its mode
 * replaces the resolved mode without dwell, so the lab can audition each mode.
 */
export interface PerformanceOverride {
  mode: PerformanceMode
  /** Energy forced on the Natural driver, 0..1, or `null` to keep the user setting. */
  energy: number | null
}

export interface PerformanceInputs {
  /** Epoch milliseconds. The resolver never reads a clock itself. */
  nowMs: number
  /** The character's own speech is playing. */
  speaking: boolean
  /** The user is speaking, as reported by voice activity detection. */
  userSpeaking: boolean
  /** The chat is generating a reply. */
  generating: boolean
  /** When the pointer last moved over the stage, or `null` when the host cannot tell. */
  cursorMovedAtMs: number | null
  desktop: DesktopActivitySnapshot | null
  /**
   * Whether the stage is visible (`document.visibilityState`). A hidden stage
   * cannot be watching the user, so desktop activity does not select `watching`.
   */
  visible: boolean
  override: PerformanceOverride | null
}

/**
 * Hysteresis carried between resolver calls. The stage keeps the latest value
 * and passes it back on the next call; start from {@link initialResolverMemory}.
 */
export interface ResolverMemory {
  readonly mode: PerformanceMode
  /** When `mode` was entered, or `null` before the first switch so the first mode applies at once. */
  readonly modeSinceMs: number | null
  /** `userSpeaking` on the previous call, to detect the moment it turns false. */
  readonly userSpeaking: boolean
  /** When `userSpeaking` last turned false; `listening` holds for the release time from here. */
  readonly userSpeechEndedAtMs: number | null
  readonly reactSeq: number
  readonly reactKind: PerformanceReactKind
  /**
   * Whether a desktop snapshot has been seen. The first one is only a baseline:
   * its unlock and resume times can be hours old and are not news.
   */
  readonly desktopBaselined: boolean
  /** The last known unlock and resume times. A new value is a wake, whatever its age. */
  readonly unlockedAtMs: number | null
  readonly resumedAtMs: number | null
  readonly screenChange: number | null
  readonly screenReactAtMs: number | null
  /** The largest `nowMs` seen. Time is clamped to it, so a clock that steps back cannot flap modes. */
  readonly nowMs: number | null
}

export interface PerformanceResolution {
  state: PerformanceState
  memory: ResolverMemory
}

export const initialResolverMemory: ResolverMemory = Object.freeze({
  mode: 'idle',
  modeSinceMs: null,
  userSpeaking: false,
  userSpeechEndedAtMs: null,
  reactSeq: 0,
  reactKind: 'none',
  desktopBaselined: false,
  unlockedAtMs: null,
  resumedAtMs: null,
  screenChange: null,
  screenReactAtMs: null,
  nowMs: null,
})

// NOTICE: Every threshold below is a starting value that has not been measured against
// rendered output. Tune them in the devtools Natural lab.

/** Shortest time a mode holds before another mode can replace it. Tuning: raise if modes visibly flicker. */
const MODE_DWELL_MS = 300
/** How long `listening` outlives the moment user speech ends, bridging pauses between words. Tuning: match the VAD's end-of-speech latency. */
const LISTENING_RELEASE_MS = 500
/** Desktop input more recent than this counts as an active user. Tuning: lower if the character watches too long after the user stops. */
const WATCHING_INPUT_IDLE_SECONDS = 10
/** A pointer move more recent than this counts as activity and draws attention to the cursor. Tuning: lower for a twitchier cursor follow. */
const WATCHING_CURSOR_RECENT_MS = 3000
/** Screen change above this fraction counts as something to watch, such as video or scrolling. Tuning: raise if static desktops trigger watching. */
const WATCHING_SCREEN_CHANGE = 0.15
/** System audio above this level counts as something to watch. Tuning: raise if background music keeps the character watching. */
const WATCHING_SYSTEM_AUDIO_LEVEL = 0.1
/** Desktop input older than this means the user has left. Tuning: shorter makes the character settle sooner when nobody is there. */
const AWAY_INPUT_IDLE_SECONDS = 300
/** A screen change crossing above this fraction starts a reaction. Tuning: raise if ordinary window switches cause reactions. */
const REACT_SCREEN_CHANGE = 0.35
/** Shortest gap between two screen-change reactions. Tuning: raise if busy screens make the character react repeatedly. */
const SCREEN_CHANGE_REFRACTORY_MS = 10_000

/** Treats NaN and infinities as an unknown signal instead of a value. */
function finiteOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null
}

/** Idle time below zero cannot happen, so a negative report is unknown, not active. */
function idleSecondsOf(desktop: DesktopActivitySnapshot | null): number | null {
  const idle = finiteOrNull(desktop?.idleSeconds ?? null)
  return idle !== null && idle >= 0 ? idle : null
}

/**
 * Resolves the performance state for one frame.
 *
 * Pure: time comes only from `inputs.nowMs`, and all hysteresis lives in the
 * returned memory, which the caller passes back on the next call.
 *
 * Mode priority, highest first: `talking` (own speech), `listening` (user
 * speech, held for {@link LISTENING_RELEASE_MS} after it stops), `thinking`
 * (generation), `watching` (recent desktop activity), `idle`. The listening
 * release is measured from the first call that reports `userSpeaking` false, so
 * the caller must resolve immediately when that input changes. A developer
 * override replaces the mode outright. Otherwise a new mode must wait until the
 * current one has held for {@link MODE_DWELL_MS}.
 *
 * `away` is an overlay on the mode, not a mode: the character can still talk
 * while the user is away. While away, desktop activity cannot select `watching`.
 */
export function resolvePerformanceState(inputs: PerformanceInputs, previous: ResolverMemory): PerformanceResolution {
  // Clamp time so it never runs backwards. A stepped-back clock would
  // otherwise reopen dwell windows and restart refractory periods.
  const inputNowMs = finiteOrNull(inputs.nowMs)
  let nowMs = inputNowMs ?? previous.nowMs ?? 0
  if (previous.nowMs !== null && nowMs < previous.nowMs)
    nowMs = previous.nowMs

  const desktop = inputs.desktop
  const idleSeconds = idleSecondsOf(desktop)
  const screenChange = finiteOrNull(desktop?.screenChange ?? null)
  const systemAudioLevel = finiteOrNull(desktop?.systemAudioLevel ?? null)

  const suspendedAtMs = finiteOrNull(desktop?.suspendedAtMs ?? null)
  const resumedAtMs = finiteOrNull(desktop?.resumedAtMs ?? null)
  const suspended = suspendedAtMs !== null && (resumedAtMs === null || suspendedAtMs > resumedAtMs)
  const away = desktop !== null && (desktop.locked || suspended || (idleSeconds !== null && idleSeconds > AWAY_INPUT_IDLE_SECONDS))

  // Anchor the release on the falling edge, not on the last true sample, so
  // the sampling interval cannot shorten it.
  let userSpeechEndedAtMs = previous.userSpeechEndedAtMs
  if (inputs.userSpeaking)
    userSpeechEndedAtMs = null
  else if (previous.userSpeaking)
    userSpeechEndedAtMs = nowMs
  const listening = inputs.userSpeaking
    || (userSpeechEndedAtMs !== null && nowMs - userSpeechEndedAtMs < LISTENING_RELEASE_MS)

  // A cursor timestamp ahead of the clamped clock is treated as a move just now.
  const cursorMovedAtMs = finiteOrNull(inputs.cursorMovedAtMs)
  const cursorActive = cursorMovedAtMs !== null && nowMs - cursorMovedAtMs <= WATCHING_CURSOR_RECENT_MS
  // Unknown signals (`null`) never count as activity, so web and Wayland hosts
  // without desktop data fall through to `idle`.
  const desktopActive = (idleSeconds !== null && idleSeconds < WATCHING_INPUT_IDLE_SECONDS)
    || (screenChange !== null && screenChange > WATCHING_SCREEN_CHANGE)
    || (systemAudioLevel !== null && systemAudioLevel > WATCHING_SYSTEM_AUDIO_LEVEL)
  const watching = inputs.visible && !away && (cursorActive || desktopActive)

  let desiredMode: PerformanceMode = 'idle'
  if (inputs.speaking)
    desiredMode = 'talking'
  else if (listening)
    desiredMode = 'listening'
  else if (inputs.generating)
    desiredMode = 'thinking'
  else if (watching)
    desiredMode = 'watching'

  let mode = previous.mode
  let modeSinceMs = previous.modeSinceMs
  if (inputs.override !== null) {
    // The lab audition must take effect at once, so the override skips dwell.
    if (inputs.override.mode !== mode) {
      mode = inputs.override.mode
      modeSinceMs = nowMs
    }
  }
  else if (desiredMode !== mode && (modeSinceMs === null || nowMs - modeSinceMs >= MODE_DWELL_MS)) {
    mode = desiredMode
    modeSinceMs = nowMs
  }

  let reactSeq = previous.reactSeq
  let reactKind = previous.reactKind
  let desktopBaselined = previous.desktopBaselined
  let knownUnlockedAtMs = previous.unlockedAtMs
  let knownResumedAtMs = previous.resumedAtMs
  let screenReactAtMs = previous.screenReactAtMs

  let wokeThisFrame = false
  if (desktop !== null) {
    const unlockedAtMs = finiteOrNull(desktop.unlockedAtMs)
    const unlockedIsNew = unlockedAtMs !== null && unlockedAtMs !== knownUnlockedAtMs
    const resumedIsNew = resumedAtMs !== null && resumedAtMs !== knownResumedAtMs
    // The first snapshot only records the times. After it, a new time is a wake
    // even if it arrives late, because each value is reacted to exactly once.
    if (desktopBaselined && (unlockedIsNew || resumedIsNew)) {
      reactSeq += 1
      reactKind = 'wake'
      wokeThisFrame = true
    }
    // An unknown (`null`) time keeps the last known one, so a value that
    // returns after a gap in reporting is not mistaken for a new wake.
    if (unlockedAtMs !== null)
      knownUnlockedAtMs = unlockedAtMs
    if (resumedAtMs !== null)
      knownResumedAtMs = resumedAtMs
    desktopBaselined = true
  }

  // React on the upward crossing only, so a screen that stays busy reacts once.
  const screenRose = screenChange !== null
    && screenChange > REACT_SCREEN_CHANGE
    && (previous.screenChange === null || previous.screenChange <= REACT_SCREEN_CHANGE)
  const screenRefractory = screenReactAtMs !== null && nowMs - screenReactAtMs < SCREEN_CHANGE_REFRACTORY_MS
  // A state carries one reactKind, so a wake in the same frame wins and this
  // frame's screen up-cross is dropped.
  if (screenRose && !screenRefractory && !wokeThisFrame) {
    reactSeq += 1
    reactKind = 'screen-change'
    screenReactAtMs = nowMs
  }

  let attention: PerformanceAttention = 'camera'
  if (mode === 'watching')
    attention = cursorActive ? 'cursor' : 'screen'

  return {
    state: { mode, attention, away, reactSeq, reactKind },
    memory: {
      mode,
      modeSinceMs,
      userSpeaking: inputs.userSpeaking,
      userSpeechEndedAtMs,
      reactSeq,
      reactKind,
      desktopBaselined,
      unlockedAtMs: knownUnlockedAtMs,
      resumedAtMs: knownResumedAtMs,
      screenChange,
      screenReactAtMs,
      nowMs,
    },
  }
}
