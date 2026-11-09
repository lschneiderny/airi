/* global workspace, callDBus */

// KWin does not invoke the reply callback on a D-Bus error. Leaving inFlight
// set makes a dead receiver quiescent without a timer or repeated failed calls.
(() => {
  let inFlight = false
  let sent = null
  let latest = null

  function send() {
    if (inFlight || !latest || (sent && sent.x === latest.x && sent.y === latest.y))
      return
    sent = latest
    inFlight = true
    callDBus('__AIRI_BUS_NAME__', '/bridge', 'ai.moeru.airi.LinuxDesktop1', 'Cursor', JSON.stringify(sent), () => {
      inFlight = false
      send()
    })
  }

  function changed() {
    const position = workspace.cursorPos
    latest = { x: position.x, y: position.y }
    send()
  }

  workspace.cursorPosChanged.connect(changed)
  changed()
})()
