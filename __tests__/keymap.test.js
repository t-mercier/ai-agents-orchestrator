const K = require('../renderer/lib/keymap')

const ev = (o) => ({ key: '', code: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o })

describe('keymap', () => {
  test('a keypress becomes a combo that does not depend on the layout', () => {
    expect(K.fromEvent(ev({ key: 'n', code: 'KeyN', metaKey: true }), true)).toBe('Mod+N')
    // ⌥ changes e.key on a Mac ("˜" for ⌥N); the physical key is what the user pressed.
    expect(K.fromEvent(ev({ key: '˜', code: 'KeyN', metaKey: true, altKey: true, shiftKey: true }), true)).toBe('Mod+Alt+Shift+N')
    expect(K.fromEvent(ev({ key: '!', code: 'Digit1', metaKey: true, shiftKey: true }), true)).toBe('Mod+Shift+1')
    expect(K.fromEvent(ev({ key: 'F5', code: 'F5' }), true)).toBe('F5')
    // Ctrl is Mod off a Mac, and its own modifier on one.
    expect(K.fromEvent(ev({ key: 'n', code: 'KeyN', ctrlKey: true }), false)).toBe('Mod+N')
    expect(K.fromEvent(ev({ key: 'n', code: 'KeyN', ctrlKey: true }), true)).toBe('Ctrl+N')
  })

  test('a modifier on its own is not a combo yet', () => {
    expect(K.fromEvent(ev({ key: 'Meta', code: 'MetaLeft', metaKey: true }), true)).toBe(null)
    expect(K.fromEvent(ev({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }), true)).toBe(null)
  })

  test('labels read the way the platform writes them', () => {
    expect(K.label('Mod+Shift+N', true)).toBe('⌘⇧N')
    expect(K.label('Ctrl+Alt+K', true)).toBe('⌃⌥K')
    expect(K.label('Mod+Shift+N', false)).toBe('Ctrl+Shift+N')
    expect(K.label('Mod+Comma', true)).toBe('⌘,')
  })

  test('a letter without ⌘, Ctrl or ⌥ is refused: it would fire while typing', () => {
    expect(K.check('N', {}, 'x').ok).toBe(false)
    expect(K.check('Shift+N', {}, 'x').ok).toBe(false)
    expect(K.check('F5', {}, 'x').ok).toBe(true)
    expect(K.check('Mod+Shift+N', {}, 'x').ok).toBe(true)
  })

  test('a combo the system or the app already owns is refused, with its owner', () => {
    for (const c of ['Mod+Q', 'Mod+W', 'Mod+C', 'Mod+V', 'Mod+X', 'Mod+A', 'Mod+Z', 'Mod+Shift+Z', 'Mod+H', 'Mod+M']) {
      expect(K.check(c, {}, 'x').ok).toBe(false)
    }
    const k = K.check('Mod+K', {}, 'x')
    expect(k.ok).toBe(false)
    expect(k.why).toMatch(/assistant/i)
  })

  test('a combo already given to another action names that action', () => {
    const r = K.check('Mod+Shift+N', { newSession: 'Mod+Shift+N' }, 'syncAll')
    expect(r).toEqual({ ok: false, taken: 'newSession' })
    // Recording the same combo again for its own action is fine.
    expect(K.check('Mod+Shift+N', { newSession: 'Mod+Shift+N' }, 'newSession').ok).toBe(true)
  })

  test('only combos that parse survive a load, so a hand-edited store cannot break the keys', () => {
    expect(K.clean({ a: 'Mod+N', b: 'nonsense', c: 42, d: 'N', e: 'Mod+K' })).toEqual({ a: 'Mod+N' })
    expect(K.clean(null)).toEqual({})
  })
})
