export interface PlacementRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

// KWin reports internalId as a braced UUID; anything else never came from OwnWindows.
const windowIdPattern = /^\{[\w-]{1,64}\}$/

/**
 * One-shot script that runs `body` with `window` bound to the AIRI window
 * whose `internalId` is `id`. A foreign window is compared by pid alone and
 * never reaches the id check or the body, so actuators cannot read or write it.
 */
function ownWindowScript(ownPids: readonly number[], id: string, body: string): string {
  if (!windowIdPattern.test(id))
    throw new TypeError('Actuators require a bound window id')
  const pids = ownPids.filter(pid => Number.isSafeInteger(pid) && pid > 0)
  if (pids.length === 0)
    throw new TypeError('Actuators require an AIRI process')
  return `(() => {
  const ownPids = ${JSON.stringify(pids)};
  const id = ${JSON.stringify(id)};
  const windows = 'activeWindow' in workspace ? workspace.stackingOrder : workspace.clientList();
  for (const window of windows) {
    if (!ownPids.includes(window.pid) || String(window.internalId) !== id)
      continue;
${body}
  }
})()`
}

export function keepAboveScript(ownPids: readonly number[], id: string, on: boolean): string {
  return ownWindowScript(ownPids, id, `    window.keepAbove = ${on === true};`)
}

/** `rect` is the client area, as Electron and OwnWindows report it; KWin moves the frame around it. */
export function placementScript(ownPids: readonly number[], id: string, rect: PlacementRect): string {
  const { x, y, width, height } = rect
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0)
    throw new TypeError('Placement requires a finite, non-empty rectangle')
  const [rx, ry, rw, rh] = [x, y, width, height].map(Math.round)
  return ownWindowScript(ownPids, id, `    const frame = window.frameGeometry;
    const client = 'clientGeometry' in window ? window.clientGeometry : frame;
    window.frameGeometry = {
      x: ${rx} - (client.x - frame.x),
      y: ${ry} - (client.y - frame.y),
      width: ${rw} + (frame.width - client.width),
      height: ${rh} + (frame.height - client.height),
    };`)
}
