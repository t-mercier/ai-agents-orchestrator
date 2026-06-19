const { createPtyOwners } = require('../data/pty-owners')

describe('pty-owners refcount', () => {
  let o
  beforeEach(() => { o = createPtyOwners() })

  it('tracks owners per session', () => {
    o.add('s1', 1)
    o.add('s1', 2)
    expect(o.ownerCount('s1')).toBe(2)
    expect(o.size()).toBe(1)
  })

  it('release returns false while other owners remain, true on the last', () => {
    o.add('s1', 1)
    o.add('s1', 2)
    expect(o.release('s1', 1)).toBe(false)   // window 2 still owns it
    expect(o.release('s1', 2)).toBe(true)    // last owner → kill
    expect(o.ownerCount('s1')).toBe(0)
  })

  it('release of an unknown session/window is false', () => {
    expect(o.release('nope', 9)).toBe(false)
  })

  it('releaseWindow returns only sessions that lost their last owner', () => {
    o.add('shared', 1); o.add('shared', 2)   // two windows
    o.add('solo', 1)                          // only window 1
    const toKill = o.releaseWindow(1)
    expect(toKill).toEqual(['solo'])          // shared still owned by window 2
    expect(o.ownerCount('shared')).toBe(1)
  })

  it('releaseWindow kills everything a sole window owned', () => {
    o.add('a', 5); o.add('b', 5); o.add('c', 5)
    expect(o.releaseWindow(5).sort()).toEqual(['a', 'b', 'c'])
    expect(o.size()).toBe(0)
  })

  it('drop forgets a session that exited on its own', () => {
    o.add('s1', 1); o.add('s1', 2)
    o.drop('s1')
    expect(o.ownerCount('s1')).toBe(0)
    expect(o.releaseWindow(1)).toEqual([])   // nothing left to kill
  })

  it('the drawer + detached-window shared-session scenario', () => {
    // main window (1) opens terminal, then detached window (2) opens same session
    o.add('sess', 1)
    o.add('sess', 2)
    // detached window closes → pty must NOT die (main still shows it)
    expect(o.releaseWindow(2)).toEqual([])
    expect(o.ownerCount('sess')).toBe(1)
    // main window closes → now it dies
    expect(o.releaseWindow(1)).toEqual(['sess'])
  })
})
