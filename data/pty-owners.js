// Tracks which windows currently display a terminal for each sessionId, so a pty
// is killed only when the LAST window showing it goes away (ADR-002). Pure
// bookkeeping: methods return the sessionIds that should be killed; the caller
// (main.js) performs the actual ptyManager.kill — keeps this unit-testable
// without Electron.
function createPtyOwners() {
  const owners = new Map() // sessionId → Set<windowId>

  function add(sessionId, windowId) {
    if (!owners.has(sessionId)) owners.set(sessionId, new Set())
    owners.get(sessionId).add(windowId)
  }

  // Remove one window's ownership. Returns true if it was the LAST owner
  // (i.e. the pty should now be killed).
  function release(sessionId, windowId) {
    const set = owners.get(sessionId)
    if (!set) return false
    set.delete(windowId)
    if (set.size === 0) { owners.delete(sessionId); return true }
    return false
  }

  // A window closed: drop it from every session. Returns the list of sessionIds
  // that lost their last owner (caller should kill those ptys).
  function releaseWindow(windowId) {
    const toKill = []
    for (const sessionId of [...owners.keys()]) {
      if (release(sessionId, windowId)) toKill.push(sessionId)
    }
    return toKill
  }

  // The pty exited on its own — forget all ownership for it.
  function drop(sessionId) { owners.delete(sessionId) }

  function ownerCount(sessionId) { return owners.get(sessionId)?.size || 0 }
  function size() { return owners.size }

  return { add, release, releaseWindow, drop, ownerCount, size }
}

module.exports = { createPtyOwners }
