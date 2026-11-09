/* global workspace, callDBus */

(() => {
  const api = 'activeWindow' in workspace && workspace.windowActivated
    ? 'plasma6'
    : 'activeClient' in workspace && workspace.clientActivated ? 'plasma5' : 'unsupported'
  const pending = []
  let inFlight = false
  let stopped = false
  let active = null
  let own = []
  let ownPids = []

  // One outstanding call for the whole bridge. Pending snapshots replace their
  // older value; a failed call never gets a reply and therefore stops this pump.
  // KWin swallows exceptions thrown inside a reply callback, so the callback
  // releases the pump in `finally`; otherwise one throw would lose every later push.
  function send() {
    if (stopped || inFlight || pending.length === 0)
      return
    const next = pending.shift()
    inFlight = true
    const args = ['__AIRI_BUS_NAME__', '/bridge', 'ai.moeru.airi.LinuxDesktop1', next.method]
    if (next.method !== 'OwnPids')
      args.push(JSON.stringify(next.payload))
    args.push((reply) => {
      try {
        if (next.method === 'OwnPids')
          receivePids(reply)
      }
      finally {
        inFlight = false
        send()
      }
    })
    callDBus(...args)
  }

  function receivePids(reply) {
    try {
      const pids = JSON.parse(reply)
      if (!Array.isArray(pids) || pids.length > 256 || !pids.every(pid => Number.isSafeInteger(pid) && pid > 0)) {
        stopped = true
        return
      }
      ownPids = pids
    }
    catch (error) {
      if (!(error instanceof SyntaxError))
        throw error
      stopped = true
      return
    }
    updateOwn()
  }

  // A destroyed window keeps its script wrapper, but its signals read as
  // undefined. Only AIRI's own windows and the active window reach this helper.
  function disconnect(signal, listener) {
    if (signal)
      signal.disconnect(listener)
  }

  function enqueue(method, payload) {
    const previous = pending.find(item => item.method === method)
    if (previous)
      previous.payload = payload
    else
      pending.push({ method, payload })
    send()
  }

  function sendActive() {
    enqueue('Active', active
      ? {
          caption: String(active.caption).slice(0, 4096),
          resourceClass: String(active.resourceClass).slice(0, 4096),
          desktopFileName: String(active.desktopFileName).slice(0, 4096),
          pid: active.pid,
          fullScreen: active.fullScreen,
        }
      : null)
  }

  function activated() {
    if (active) {
      disconnect(active.captionChanged, sendActive)
      disconnect(active.fullScreenChanged, sendActive)
    }
    active = api === 'plasma6' ? workspace.activeWindow : workspace.activeClient
    if (active) {
      active.captionChanged.connect(sendActive)
      active.fullScreenChanged.connect(sendActive)
    }
    sendActive()
  }

  function sendOwn() {
    // A destroyed own window has no geometry until the next OwnPids refresh drops it.
    enqueue('OwnWindows', own.filter(window => window.frameGeometry).map((window) => {
      const rect = 'clientGeometry' in window ? window.clientGeometry : window.frameGeometry
      return {
        id: String(window.internalId),
        pid: window.pid,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        keepAbove: window.keepAbove,
        // Plasma 5 does not expose Window.output.
        outputScale: window.output ? window.output.devicePixelRatio : 1,
      }
    }))
  }

  function updateOwn() {
    for (const window of own) {
      disconnect(window.frameGeometryChanged, sendOwn)
      disconnect(window.keepAboveChanged, sendOwn)
    }
    // NOTICE:
    // Compare only pid with OwnPids inside KWin.
    // Existing AIRI windows need rediscovery after KWin restarts.
    // Never store, send, or log foreign PIDs; never read other foreign properties.
    // Source: todo 4a attempt 2, orchestrator C1 ruling (2026-11-09).
    // Remove when KWin offers ownership-scoped lookup.
    own = (api === 'plasma6' ? workspace.stackingOrder : workspace.clientList())
      .filter(window => ownPids.includes(window.pid))
      .slice(0, 32)
    for (const window of own) {
      window.frameGeometryChanged.connect(sendOwn)
      window.keepAboveChanged.connect(sendOwn)
    }
    sendOwn()
  }

  function requestPids() {
    enqueue('OwnPids')
  }

  enqueue('Hello', { api })
  if (api === 'unsupported')
    return
  if (api === 'plasma6') {
    workspace.windowActivated.connect(activated)
    workspace.windowAdded.connect(requestPids)
    workspace.windowRemoved.connect(updateOwn)
  }
  else {
    workspace.clientActivated.connect(activated)
    workspace.clientAdded.connect(requestPids)
    workspace.clientRemoved.connect(updateOwn)
  }
  activated()
  requestPids()
})()
