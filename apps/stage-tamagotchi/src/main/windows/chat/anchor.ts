import type { BrowserWindow, Rectangle } from 'electron'

import type { StageCharacterPlacement } from '../../../shared/eventa'

import { debounce } from 'es-toolkit'

import { windowOriginTrusted } from '../../services/electron/host-capabilities'
import { wholePixels } from './floating-placement'

/**
 * Longest wait for more placement changes before an attached chat re-places. A
 * drag release publishes a few placements in a row; the chat follows the last.
 */
const placementDebounceMs = 100

/**
 * The rectangle an attached floating chat lines up against. The chat stays
 * flush with it and moves when it changes.
 */
export interface ChatAnchor {
  /** The rectangle in screen DIP, or `null` while there is nothing to attach to yet. */
  getRect: () => Rectangle | null
  /** Calls `listener` whenever the rectangle may have changed. Returns the function that stops it. */
  onChange: (listener: () => void) => () => void
  /**
   * Whether the chat may be a native child window of the anchor's window, so
   * the window server moves it along. Only a window that is itself the anchor
   * moves like that.
   */
  nativeChild: boolean
}

/** What the desktop stage host publishes about the character (`StageWindowHost`). */
export interface CharacterPlacementSource {
  getCharacterPlacement: () => StageCharacterPlacement | null
  onCharacterPlacementChange: (listener: (placement: StageCharacterPlacement) => void) => () => void
}

/** The anchor of the classic window mode: the main window's own bounds. */
export function createMainWindowAnchor(main: BrowserWindow): ChatAnchor {
  return {
    getRect: () => windowOriginTrusted() ? main.getBounds() : null,
    onChange(listener) {
      main.on('move', listener)
      main.on('resize', listener)
      return () => {
        main.off('move', listener)
        main.off('resize', listener)
      }
    },
    nativeChild: true,
  }
}

/**
 * The anchor of the desktop stage mode: the character's home rectangle.
 *
 * The chat attaches to where she lives, never to her live rectangle, so a walk
 * or a drag in progress does not drag the chat along. The rectangle is rounded
 * to whole pixels because window bounds reject fractions.
 */
export function createCharacterAnchor(source: CharacterPlacementSource): ChatAnchor {
  return {
    getRect() {
      const home = source.getCharacterPlacement()?.homeBounds
      if (!home)
        return null
      return { x: wholePixels(home.x), y: wholePixels(home.y), width: wholePixels(home.width), height: wholePixels(home.height) }
    },
    onChange(listener) {
      const settled = debounce(listener, placementDebounceMs)
      const stop = source.onCharacterPlacementChange(() => settled())
      return () => {
        stop()
        settled.cancel()
      }
    },
    nativeChild: false,
  }
}
