const T = require('../renderer/lib/term-theme')

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite']

describe('terminal theme', () => {
  test('every named theme defines the whole palette', () => {
    for (const name of ['night', 'dusk', 'mist', 'day']) {
      const th = T.THEMES[name]
      for (const k of ['background', 'foreground', 'cursor', 'cursorAccent', 'selectionBackground', ...ANSI]) {
        expect(th[k]).toBeTruthy()
      }
    }
  })

  test('auto follows the app theme: Dark, Dusk, Mist, Light', () => {
    expect(T.resolve({ theme: 'auto' }, 'dark').background).toBe(T.THEMES.night.background)
    expect(T.resolve({ theme: 'auto' }, 'dusk').background).toBe(T.THEMES.dusk.background)
    expect(T.resolve({ theme: 'auto' }, 'mist').background).toBe(T.THEMES.mist.background)
    expect(T.resolve({ theme: 'auto' }, 'light').background).toBe(T.THEMES.day.background)
    expect(T.resolve({ theme: 'auto' }, 'neon').background).toBe(T.THEMES.night.background)
  })

  test('a terminal theme saved by name moves to following the app', () => {
    expect(T.migrate({ theme: 'dusk' }).theme).toBe('auto')
    expect(T.migrate({ theme: 'custom', bg: '#002b36' }).theme).toBe('custom')
  })

  test('custom keeps the colours the user picked, on the night palette', () => {
    const th = T.resolve({ theme: 'custom', bg: '#000000', fg: '#ffffff' }, 'light')
    expect(th.background).toBe('#000000')
    expect(th.foreground).toBe('#ffffff')
    expect(th.red).toBe(T.THEMES.night.red)
  })

  test('an unknown terminal theme falls back to auto rather than to nothing', () => {
    expect(T.resolve({ theme: 'neon' }, 'dark').background).toBe(T.THEMES.night.background)
  })

  test('new prefs start on auto with Source Code Pro', () => {
    const p = T.migrate({})
    expect(p.theme).toBe('auto')
    expect(p.font).toBe('sourcecode')
  })

  test('prefs saved before themes existed keep the font and size, and untouched colours become auto', () => {
    const p = T.migrate({ font: 'fira', fontSize: 14, bg: '#1c1c1e', fg: '#d9d9d9' })
    expect(p).toMatchObject({ theme: 'auto', font: 'fira', fontSize: 14 })
  })

  test('colours someone picked before themes existed are kept as custom', () => {
    expect(T.migrate({ bg: '#002b36', fg: '#d9d9d9' }).theme).toBe('custom')
  })

  test('Source Code Pro is a font choice, and an unknown key falls back to it', () => {
    expect(T.fontFamily('sourcecode')).toContain('Source Code Pro')
    expect(T.fontFamily('nope')).toContain('Source Code Pro')
    expect(T.fontFamily('fira')).toContain('Fira Code')
  })
})
