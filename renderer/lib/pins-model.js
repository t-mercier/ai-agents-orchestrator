// Which sessions are pinned. UMD: window.CSMPins in the renderer + require() in jest.
// No DOM, no storage: app.js owns persistence. Keys are sessionKey() values.
(function (root, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.CSMPins = api
})(typeof self !== 'undefined' ? self : this, function () {
  // A grid screenful. A refused pin returns 'full' so the caller can say why.
  const PIN_LIMIT = 8

  function toggle(keys, key) {
    if (keys.includes(key)) return { keys: keys.filter(k => k !== key), result: 'unpinned' }
    if (keys.length >= PIN_LIMIT) return { keys, result: 'full' }
    return { keys: [...keys, key], result: 'pinned' }
  }

  // A pin only means something in the Running tab: once a session is closed, archived or
  // gone, its pin is dropped, or it would hold a slot nobody can see. An empty running
  // list keeps every pin, so a fetch that returned nothing cannot wipe them all.
  function keepRunning(keys, runningKeys) {
    if (!runningKeys.length) return keys
    const live = new Set(runningKeys)
    return keys.filter(k => live.has(k))
  }

  return { PIN_LIMIT, toggle, keepRunning }
})
