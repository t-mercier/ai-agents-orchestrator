const ptyManager = require('../data/pty-manager')

// Fake node-pty: each spawned proc records calls and lets tests drive onExit.
function makeFakePtyLib() {
  const spawned = []
  const lib = {
    spawn(shell, args, opts) {
      let exitCb = null
      const proc = {
        shell, args, opts,
        written: [],
        killed: false,
        onExit(cb) { exitCb = cb },
        onData() { /* not needed for lifecycle tests */ },
        write(d) { this.written.push(d) },
        resize(c, r) { this.lastResize = [c, r] },
        kill() { this.killed = true },
        _fireExit() { if (exitCb) exitCb({ exitCode: 0 }) },
      }
      spawned.push(proc)
      return proc
    },
  }
  return { lib, spawned }
}

describe('pty-manager lifecycle', () => {
  let fake
  beforeEach(() => {
    fake = makeFakePtyLib()
    ptyManager._reset()
    ptyManager._setPtyLib(fake.lib)
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
    ptyManager._reset()
  })

  it('registers a spawned session', () => {
    ptyManager.spawn('sess1', '/Users/x/proj')
    expect(ptyManager.has('sess1')).toBe(true)
    expect(ptyManager.count()).toBe(1)
  })

  it('rejects an invalid sessionId', () => {
    expect(() => ptyManager.spawn('bad id with space', '/x')).toThrow(/invalid sessionId/)
    expect(ptyManager.count()).toBe(0)
  })

  it('writes the resume command (cd + claude --resume) after the delay', () => {
    ptyManager.spawn('sess1', '/Users/x/proj')
    jest.advanceTimersByTime(300)
    const proc = fake.spawned[0]
    expect(proc.written.join('')).toContain("cd '/Users/x/proj' && claude --resume sess1 --model 'opus[1m]'")
  })

  it('shell-quotes a cwd containing single quotes (no injection)', () => {
    ptyManager.spawn('sess1', "/Users/x/it's a dir")
    jest.advanceTimersByTime(300)
    expect(fake.spawned[0].written.join('')).toContain("cd '/Users/x/it'\\''s a dir'")
  })

  it('falls back to home dir for a non-absolute cwd', () => {
    ptyManager.spawn('sess1', 'relative/path')
    jest.advanceTimersByTime(300)
    // home dir is absolute; command should not contain the relative path verbatim as cwd
    const written = fake.spawned[0].written.join('')
    expect(written).toMatch(/^cd '\//)
  })

  it('cleans up the map entry when the pty exits (no zombie/listener leak)', () => {
    ptyManager.spawn('sess1', '/x')
    expect(ptyManager.has('sess1')).toBe(true)
    fake.spawned[0]._fireExit()
    expect(ptyManager.has('sess1')).toBe(false)
    expect(ptyManager.count()).toBe(0)
  })

  it('fires the onExit listener with the sessionId on exit', () => {
    const seen = []
    ptyManager.onExit(id => seen.push(id))
    ptyManager.spawn('sess1', '/x')
    fake.spawned[0]._fireExit()
    expect(seen).toEqual(['sess1'])
  })

  it('does NOT write the resume command if the pty exited before the delay', () => {
    ptyManager.spawn('sess1', '/x')
    fake.spawned[0]._fireExit()      // dies immediately
    jest.advanceTimersByTime(300)
    expect(fake.spawned[0].written.join('')).toBe('')
  })

  it('kill() terminates the proc and removes it from the map', () => {
    ptyManager.spawn('sess1', '/x')
    ptyManager.kill('sess1')
    expect(fake.spawned[0].killed).toBe(true)
    expect(ptyManager.has('sess1')).toBe(false)
  })

  it('kill() on an unknown id is a no-op', () => {
    expect(() => ptyManager.kill('nope')).not.toThrow()
  })

  it('killAll() terminates every session', () => {
    ptyManager.spawn('a', '/x')
    ptyManager.spawn('b', '/y')
    ptyManager.spawn('c', '/z')
    expect(ptyManager.count()).toBe(3)
    ptyManager.killAll()
    expect(ptyManager.count()).toBe(0)
    expect(fake.spawned.every(p => p.killed)).toBe(true)
  })

  it('write() and resize() target the right proc', () => {
    ptyManager.spawn('sess1', '/x')
    ptyManager.write('sess1', 'ls\r')
    ptyManager.resize('sess1', 120, 40)
    const proc = fake.spawned[0]
    expect(proc.written).toContain('ls\r')
    expect(proc.lastResize).toEqual([120, 40])
  })

  it('a stale exit (proc already replaced) does not delete the new entry', () => {
    ptyManager.spawn('sess1', '/x')
    const first = fake.spawned[0]
    ptyManager.kill('sess1')
    ptyManager.spawn('sess1', '/y')   // new proc, same id
    first._fireExit()                  // late exit from the old proc
    expect(ptyManager.has('sess1')).toBe(true)  // new entry preserved
  })
})
