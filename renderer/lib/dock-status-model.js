// What the Dock icon's status badge shows, decided from the live sessions.
// UMD: window.CSMDockStatus in the renderer, require() in jest. Pure, no DOM.
//
// The classification is the one the Running list uses for its dots (ui.js, board.js): a
// session waits when its status is 'waiting' and is busy when it is 'busy'. Only live
// sessions count (state 'active'): a stale, closed or archived one is not running.
(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.CSMDockStatus = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Waiting outranks busy: when anything waits for the user, the badge counts only those.
  function decide(sessions) {
    let waiting = 0
    let busy = 0
    for (const s of sessions || []) {
      if (!s || s.state !== 'active') continue
      if (s.status === 'waiting') waiting++
      else if (s.status === 'busy') busy++
    }
    if (waiting > 0) return { kind: 'waiting', count: waiting }
    if (busy > 0) return { kind: 'busy', count: busy }
    return { kind: 'none', count: 0 }
  }

  return { decide }
})
