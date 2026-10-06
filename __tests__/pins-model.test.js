const Pins = require('../renderer/lib/pins-model')

describe('toggle', () => {
  test('pins a key below the limit', () => {
    expect(Pins.toggle(['a'], 'b')).toEqual({ keys: ['a', 'b'], result: 'pinned' })
  })

  test('unpins a pinned key', () => {
    expect(Pins.toggle(['a', 'b'], 'a')).toEqual({ keys: ['b'], result: 'unpinned' })
  })

  test('refuses a new pin at the limit and says so', () => {
    const full = Array.from({ length: Pins.PIN_LIMIT }, (_, i) => `k${i}`)
    expect(Pins.toggle(full, 'new')).toEqual({ keys: full, result: 'full' })
  })

  test('still unpins at the limit', () => {
    const full = Array.from({ length: Pins.PIN_LIMIT }, (_, i) => `k${i}`)
    expect(Pins.toggle(full, 'k3').result).toBe('unpinned')
  })
})

describe('keepRunning', () => {
  test('drops pins whose session left the Running tab (closed, archived or gone)', () => {
    expect(Pins.keepRunning(['a', 'closed', 'gone'], ['a', 'b'])).toEqual(['a'])
  })

  test('keeps every pin when the running list is empty, so a failed fetch cannot wipe them', () => {
    expect(Pins.keepRunning(['a', 'b'], [])).toEqual(['a', 'b'])
  })
})
